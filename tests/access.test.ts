import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cart } from '../src/models/Cart';
import { User } from '../src/models/User';
import { app, createDrop, createProduct, createUser, newId } from './helpers';

let server: Server;

beforeAll(() => {
  server = app.listen(0);
});

afterAll(() => {
  server.close();
});

const api = () => request(server);

const productBody = (name: string) => ({
  name,
  description: 'A product created through the admin API.',
  category: 'Test',
  basePrice: 1000,
});

const dropBody = (productId: string) => ({
  productId,
  startsAt: new Date(Date.now() + 3_600_000).toISOString(),
  endsAt: new Date(Date.now() + 7_200_000).toISOString(),
  dropPrice: 500,
  stockTotal: 5,
});

async function adminWithDrop() {
  const admin = await createUser('admin');
  const product = await api()
    .post('/admin/products')
    .set('Cookie', admin.cookie)
    .send(productBody('Owned product'));
  const drop = await api()
    .post('/admin/drops')
    .set('Cookie', admin.cookie)
    .send(dropBody(product.body.id));
  return {
    admin,
    productId: product.body.id as string,
    dropId: drop.body.id as string,
  };
}

describe('authentication', () => {
  it('rejects invalid registration input with field errors', async () => {
    const response = await api()
      .post('/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION');
    expect(Object.keys(response.body.details.fieldErrors)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });

  it('registers, sets an httpOnly cookie and then identifies the user', async () => {
    const agent = request.agent(server);

    const registered = await agent.post('/auth/register').send({
      name: 'Test Person',
      email: 'person@example.com',
      password: 'a-long-password',
    });
    const cookie = String(registered.headers['set-cookie']);

    expect(registered.status).toBe(201);
    expect(cookie).toContain('dropcart_token=');
    expect(cookie).toContain('HttpOnly');

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('person@example.com');
  });

  it('does not allow the same email twice', async () => {
    const body = {
      name: 'Twice',
      email: 'twice@example.com',
      password: 'a-long-password',
    };
    await api().post('/auth/register').send(body);

    const second = await api().post('/auth/register').send(body);
    expect(second.status).toBe(409);
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    await api().post('/auth/register').send({
      name: 'Known',
      email: 'known@example.com',
      password: 'a-long-password',
    });

    const wrongPassword = await api()
      .post('/auth/login')
      .send({ email: 'known@example.com', password: 'not-the-password' });
    const unknownEmail = await api()
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever-it-is' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error).toBe(wrongPassword.body.error);
  });

  it('has no guest endpoint outside demo mode', async () => {
    const response = await api().post('/auth/guest');
    expect(response.status).toBe(404);
  });

  it('rejects requests without a session', async () => {
    const response = await api().get('/auth/me');
    expect(response.status).toBe(401);
  });
  it('answers the session check without an error when nobody is signed in', async () => {
    const response = await api().get('/auth/session');

    expect(response.status).toBe(200);
    expect(response.body.user).toBeNull();
  });

  it('returns the user for a valid session and null for a stale one', async () => {
    const shopper = await createUser();
    const valid = await api()
      .get('/auth/session')
      .set('Cookie', shopper.cookie);
    expect(valid.body.user.id).toBe(shopper.id);

    await User.deleteOne({ _id: shopper.id });
    const stale = await api()
      .get('/auth/session')
      .set('Cookie', shopper.cookie);
    expect(stale.status).toBe(200);
    expect(stale.body.user).toBeNull();
  });
  it('blocks repeated failed sign-ins for the same email', async () => {
    const body = {
      email: 'victim@example.com',
      password: 'wrong-password-1',
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await api().post('/auth/login').send(body);
    }

    const blocked = await api().post('/auth/login').send(body);

    expect(blocked.status).toBe(429);
  });
});

describe('roles', () => {
  it('keeps shoppers and visitors out of the admin area', async () => {
    const shopper = await createUser('shopper');

    expect(
      (await api().get('/admin/overview').set('Cookie', shopper.cookie)).status,
    ).toBe(403);
    expect((await api().get('/admin/overview')).status).toBe(401);
  });

  it('reads the role from the database, not from the token', async () => {
    const admin = await createUser('admin');
    expect(
      (await api().get('/admin/overview').set('Cookie', admin.cookie)).status,
    ).toBe(200);

    await User.updateOne({ _id: admin.id }, { role: 'shopper' });

    expect(
      (await api().get('/admin/overview').set('Cookie', admin.cookie)).status,
    ).toBe(403);
  });

  it('lets only superadmins list users', async () => {
    const admin = await createUser('admin');
    const superadmin = await createUser('superadmin');

    expect(
      (await api().get('/admin/users').set('Cookie', admin.cookie)).status,
    ).toBe(403);

    const listed = await api()
      .get('/admin/users')
      .set('Cookie', superadmin.cookie);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.items)).toBe(true);
  });

  it('stops anyone from changing their own role', async () => {
    const superadmin = await createUser('superadmin');

    const response = await api()
      .patch(`/admin/users/${superadmin.id}/role`)
      .set('Cookie', superadmin.cookie)
      .send({ role: 'shopper' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SELF_CHANGE');
  });

  it("lets a superadmin change another user's role", async () => {
    const superadmin = await createUser('superadmin');
    const shopper = await createUser('shopper');

    const response = await api()
      .patch(`/admin/users/${shopper.id}/role`)
      .set('Cookie', superadmin.cookie)
      .send({ role: 'admin' });

    expect(response.status).toBe(200);
    expect((await User.findById(shopper.id))?.role).toBe('admin');
  });
});

describe('ownership scoping', () => {
  it("hides one admin's drops and products from another admin", async () => {
    const owner = await adminWithDrop();
    const other = await createUser('admin');

    const stats = await api()
      .get(`/admin/drops/${owner.dropId}/stats`)
      .set('Cookie', other.cookie);
    const edit = await api()
      .put(`/admin/products/${owner.productId}`)
      .set('Cookie', other.cookie)
      .send(productBody('Hijacked'));
    const schedule = await api()
      .post('/admin/drops')
      .set('Cookie', other.cookie)
      .send(dropBody(owner.productId));
    const drops = await api().get('/admin/drops').set('Cookie', other.cookie);
    const products = await api()
      .get('/admin/products')
      .set('Cookie', other.cookie);

    expect(stats.status).toBe(404);
    expect(edit.status).toBe(404);
    expect(schedule.status).toBe(404);
    expect(drops.body.items).toHaveLength(0);
    expect(products.body.items).toHaveLength(0);
  });

  it('lets the owner and a superadmin see the drop', async () => {
    const owner = await adminWithDrop();
    const superadmin = await createUser('superadmin');

    const asOwner = await api()
      .get(`/admin/drops/${owner.dropId}/stats`)
      .set('Cookie', owner.admin.cookie);
    const asSuperadmin = await api()
      .get(`/admin/drops/${owner.dropId}/stats`)
      .set('Cookie', superadmin.cookie);

    expect(asOwner.status).toBe(200);
    expect(asSuperadmin.status).toBe(200);
  });

  it('only lets upcoming drops be deleted', async () => {
    const owner = await adminWithDrop();
    const deleted = await api()
      .delete(`/admin/drops/${owner.dropId}`)
      .set('Cookie', owner.admin.cookie);
    expect(deleted.status).toBe(204);

    const liveDrop = await createDrop(owner.productId);
    const refused = await api()
      .delete(`/admin/drops/${liveDrop.id}`)
      .set('Cookie', owner.admin.cookie);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('DROP_LOCKED');
  });
});

describe('cart', () => {
  it('adds an item and lists it', async () => {
    const shopper = await createUser();
    const product = await createProduct({ name: 'Cart product' });

    const added = await api()
      .post('/cart/items')
      .set('Cookie', shopper.cookie)
      .send({ productId: product.id, quantity: 1 });
    const cart = await api().get('/cart').set('Cookie', shopper.cookie);

    expect(added.status).toBe(201);
    expect(cart.body.items).toHaveLength(1);
    expect(cart.body.items[0].product.name).toBe('Cart product');
  });

  it('rejects unknown products and quantities above the limit', async () => {
    const shopper = await createUser();
    const product = await createProduct();

    const unknown = await api()
      .post('/cart/items')
      .set('Cookie', shopper.cookie)
      .send({ productId: newId(), quantity: 1 });
    const tooMany = await api()
      .post('/cart/items')
      .set('Cookie', shopper.cookie)
      .send({ productId: product.id, quantity: 5 });

    expect(unknown.status).toBe(404);
    expect(tooMany.status).toBe(400);
    expect(await Cart.countDocuments()).toBe(0);
  });
});
