import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Cart } from '../src/models/Cart';
import { Drop } from '../src/models/Drop';
import { Order } from '../src/models/Order';
import { Product } from '../src/models/Product';
import { User } from '../src/models/User';
import { resetDemoData } from '../src/services/demo.service';
import { GUEST_DOMAIN } from '../src/utils/guest';
import { createProduct, createUser, newId } from './helpers';

describe('demo reset', () => {
  it('creates the sample catalog with sales that match the stock', async () => {
    const result = await resetDemoData();

    expect(result).toEqual({ products: 8, drops: 8 });
    const drops = await Drop.find().lean();
    const unitsSold = drops.reduce(
      (sum, drop) => sum + drop.stockTotal - drop.stockRemaining,
      0,
    );
    expect(await Order.countDocuments({ status: 'paid' })).toBe(unitsSold);
    expect(unitsSold).toBe(60);
  });

  it('can be repeated without duplicating the catalog', async () => {
    await resetDemoData();
    await resetDemoData();

    expect(await Product.countDocuments()).toBe(8);
    expect(await Drop.countDocuments()).toBe(8);
  });

  it('keeps accounts and products created by admins, and clears carts', async () => {
    const admin = await createUser('admin');
    const owned = await createProduct({
      owner: admin.id,
      name: 'Admin product',
    });
    await Cart.create({ user: admin.id, items: [] });

    await resetDemoData();

    expect(await User.findById(admin.id)).not.toBeNull();
    expect(await Product.findById(owned.id)).not.toBeNull();
    expect(await Cart.countDocuments()).toBe(0);
  });

  it('deletes only guest accounts that are older than a day', async () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 3600;
    const oldGuest = await User.create({
      _id: Types.ObjectId.createFromTime(twoDaysAgo),
      name: 'Guest 1111',
      email: `guest-old@${GUEST_DOMAIN}`,
      passwordHash: 'x',
    });
    const newGuest = await User.create({
      name: 'Guest 2222',
      email: `guest-${newId()}@${GUEST_DOMAIN}`,
      passwordHash: 'x',
    });
    const regular = await createUser('shopper');

    await resetDemoData();

    expect(await User.findById(oldGuest.id)).toBeNull();
    expect(await User.findById(newGuest.id)).not.toBeNull();
    expect(await User.findById(regular.id)).not.toBeNull();
  });
});
