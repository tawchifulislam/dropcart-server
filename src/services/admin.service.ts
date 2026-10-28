import { Types } from 'mongoose';
import type { Actor } from '../middleware/auth';
import { Drop, DropRecord } from '../models/Drop';
import { Order, OrderRecord } from '../models/Order';
import { Product, ProductRecord } from '../models/Product';
import { Reservation } from '../models/Reservation';
import { Role, User } from '../models/User';
import { AppError } from '../utils/AppError';
import { escapeRegExp, isObjectId } from '../utils/text';
import {
  attachActiveDrops,
  toDropView,
  toProductView,
  withProducts,
} from './drop.service';
import { productScope, scopedProductIds } from './scope';

const CHART_DROPS = 8;
const RECENT_ORDERS = 10;
const LIST_LIMIT = 100;

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

async function heldUnits(dropIds: Types.ObjectId[]) {
  const [row] = await Reservation.aggregate<{ units: number }>([
    {
      $match: {
        status: 'active',
        expiresAt: { $gt: new Date() },
        drop: { $in: dropIds },
      },
    },
    { $group: { _id: null, units: { $sum: '$quantity' } } },
  ]);
  return row?.units ?? 0;
}

async function scopedDrops(actor: Actor) {
  const productIds = await scopedProductIds(actor);
  return Drop.find({ product: { $in: productIds } })
    .sort({ startsAt: -1 })
    .lean<DropRecord[]>();
}

export async function listScopedDrops(actor: Actor) {
  const drops = await scopedDrops(actor);
  return withProducts(drops.slice(0, LIST_LIMIT), new Date());
}

export async function getOverview(actor: Actor) {
  const now = new Date();
  const drops = await scopedDrops(actor);
  const dropIds = drops.map((drop) => drop._id);
  const recent = drops.slice(0, CHART_DROPS);

  const products = await Product.find({
    _id: { $in: recent.map((drop) => drop.product) },
  }).lean<ProductRecord[]>();
  const productById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );
  const totals = await paidTotals(recent.map((drop) => drop._id));

  const [allTime, held] = await Promise.all([
    Order.aggregate<{ revenue: number; orders: number }>([
      { $match: { status: 'paid', drop: { $in: dropIds } } },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$amount' },
          orders: { $sum: 1 },
        },
      },
    ]),
    heldUnits(dropIds),
  ]);

  return {
    totals: {
      revenue: allTime[0]?.revenue ?? 0,
      paidOrders: allTime[0]?.orders ?? 0,
      heldUnits: held,
      liveDrops: drops.filter(
        (drop) => drop.startsAt <= now && drop.endsAt > now,
      ).length,
    },
    drops: recent
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

export async function getDropStats(actor: Actor, dropId: string) {
  if (!isObjectId(dropId))
    throw new AppError(404, 'Drop not found', 'NOT_FOUND');
  const now = new Date();
  const drop = await Drop.findById(dropId).lean<DropRecord>();
  const product = drop
    ? await Product.findOne({
        _id: drop.product,
        ...productScope(actor),
      }).lean<ProductRecord>()
    : null;
  if (!drop || !product) throw new AppError(404, 'Drop not found', 'NOT_FOUND');

  const [totals, held, pending, orders] = await Promise.all([
    paidTotals([drop._id]),
    heldUnits([drop._id]),
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
    product: toProductView(product),
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

export async function listManagedProducts(actor: Actor) {
  const products = await Product.find(productScope(actor))
    .sort({ _id: -1 })
    .lean<ProductRecord[]>();
  const items = await attachActiveDrops(products);

  const ownerIds = [
    ...new Set(
      products.flatMap((product) =>
        product.owner ? [product.owner.toString()] : [],
      ),
    ),
  ];
  const owners = await User.find({ _id: { $in: ownerIds } })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const nameById = new Map(
    owners.map((owner) => [owner._id.toString(), owner.name]),
  );
  const ownerByProduct = new Map(
    products.map((product) => [
      product._id.toString(),
      product.owner?.toString(),
    ]),
  );

  return items.map((item) => {
    const ownerId = ownerByProduct.get(item.id);
    return {
      ...item,
      owner: ownerId
        ? { id: ownerId, name: nameById.get(ownerId) ?? 'Unknown' }
        : null,
    };
  });
}

export async function listUsers(search?: string) {
  const pattern = search ? new RegExp(escapeRegExp(search), 'i') : null;
  const users = await User.find(
    pattern ? { $or: [{ name: pattern }, { email: pattern }] } : {},
  )
    .sort({ _id: -1 })
    .limit(50)
    .select('name email role')
    .lean<{ _id: Types.ObjectId; name: string; email: string; role: Role }[]>();

  const counts = await Product.aggregate<{
    _id: Types.ObjectId;
    count: number;
  }>([
    { $match: { owner: { $in: users.map((user) => user._id) } } },
    { $group: { _id: '$owner', count: { $sum: 1 } } },
  ]);
  const countById = new Map(
    counts.map((row) => [row._id.toString(), row.count]),
  );

  return users.map((user) => ({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    joinedAt: user._id.getTimestamp(),
    products: countById.get(user._id.toString()) ?? 0,
  }));
}

export async function setUserRole(
  actorId: string,
  targetId: string,
  role: Role,
) {
  if (!isObjectId(targetId))
    throw new AppError(404, 'User not found', 'NOT_FOUND');
  if (targetId === actorId) {
    throw new AppError(409, 'You cannot change your own role', 'SELF_CHANGE');
  }
  const user = await User.findByIdAndUpdate(targetId, { role }, { new: true });
  if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');
  return {
    id: user.id as string,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
