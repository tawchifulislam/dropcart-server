import { Types } from 'mongoose';
import { Drop, DropRecord } from '../models/Drop';
import { Order, OrderRecord } from '../models/Order';
import { Product, ProductRecord } from '../models/Product';
import { Reservation } from '../models/Reservation';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { isObjectId } from '../utils/text';
import { toDropView, toProductView } from './drop.service';

const CHART_DROPS = 8;
const RECENT_ORDERS = 10;

interface PaidRow {
  _id: Types.ObjectId;
  revenue: number;
  orders: number;
  units: number;
}

async function paidTotals(dropIds: Types.ObjectId[]) {
  const rows = await Order.aggregate<PaidRow>([
    { $match: { status: 'paid', drop: { $in: dropIds } } },
    {
      $group: {
        _id: '$drop',
        revenue: { $sum: '$amount' },
        orders: { $sum: 1 },
        units: { $sum: '$quantity' },
      },
    },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row]));
}

async function heldUnits(match: Record<string, unknown>) {
  const [row] = await Reservation.aggregate<{ units: number }>([
    { $match: { status: 'active', expiresAt: { $gt: new Date() }, ...match } },
    { $group: { _id: null, units: { $sum: '$quantity' } } },
  ]);
  return row?.units ?? 0;
}

export async function getOverview() {
  const now = new Date();
  const drops = await Drop.find()
    .sort({ startsAt: -1 })
    .limit(CHART_DROPS)
    .lean<DropRecord[]>();
  const products = await Product.find({
    _id: { $in: drops.map((drop) => drop.product) },
  }).lean<ProductRecord[]>();
  const productById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );
  const totals = await paidTotals(drops.map((drop) => drop._id));

  const [allTime, held, liveDrops] = await Promise.all([
    Order.aggregate<{ revenue: number; orders: number }>([
      { $match: { status: 'paid' } },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$amount' },
          orders: { $sum: 1 },
        },
      },
    ]),
    heldUnits({}),
    Drop.countDocuments({ startsAt: { $lte: now }, endsAt: { $gt: now } }),
  ]);

  return {
    totals: {
      revenue: allTime[0]?.revenue ?? 0,
      paidOrders: allTime[0]?.orders ?? 0,
      heldUnits: held,
      liveDrops,
    },
    drops: drops
      .map((drop) => {
        const paid = totals.get(drop._id.toString());
        return {
          ...toDropView(drop, now),
          productName:
            productById.get(drop.product.toString())?.name ?? 'Unknown product',
          revenue: paid?.revenue ?? 0,
          paidOrders: paid?.orders ?? 0,
          unitsSold: paid?.units ?? 0,
        };
      })
      .reverse(),
  };
}

export async function getDropStats(dropId: string) {
  if (!isObjectId(dropId))
    throw new AppError(404, 'Drop not found', 'NOT_FOUND');
  const now = new Date();
  const drop = await Drop.findById(dropId).lean<DropRecord>();
  if (!drop) throw new AppError(404, 'Drop not found', 'NOT_FOUND');

  const [product, totals, held, pending, orders] = await Promise.all([
    Product.findById(drop.product).lean<ProductRecord>(),
    paidTotals([drop._id]),
    heldUnits({ drop: drop._id }),
    Order.countDocuments({ drop: drop._id, status: 'pending' }),
    Order.find({ drop: drop._id })
      .sort({ _id: -1 })
      .limit(RECENT_ORDERS)
      .lean<OrderRecord[]>(),
  ]);

  const users = await User.find({
    _id: { $in: orders.map((order) => order.user) },
  })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const nameById = new Map(
    users.map((user) => [user._id.toString(), user.name]),
  );
  const paid = totals.get(drop._id.toString());

  return {
    drop: toDropView(drop, now),
    product: product ? toProductView(product) : null,
    revenue: paid?.revenue ?? 0,
    paidOrders: paid?.orders ?? 0,
    unitsSold: paid?.units ?? 0,
    heldUnits: held,
    pendingOrders: pending,
    recentOrders: orders.map((order) => ({
      id: order._id.toString(),
      status: order.status,
      amount: order.amount,
      quantity: order.quantity,
      createdAt: order._id.getTimestamp(),
      customer: nameById.get(order.user.toString()) ?? 'Customer',
    })),
  };
}
