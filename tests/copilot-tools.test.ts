import { describe, expect, it } from 'vitest';
import { executeTool } from '../src/copilot/tools';
import { Cart } from '../src/models/Cart';
import { createDrop, createProduct, newId } from './helpers';

interface Row {
  name: string;
  price: number;
  status: string;
}

const context = () => ({ userId: newId() });

async function seedCatalog() {
  const jacket = await createProduct({
    name: 'Rain Day Shell Jacket',
    category: 'Clothing',
    description: 'Seam-sealed waterproof shell with a packable hood.',
    basePrice: 2500,
  });
  await createDrop(jacket.id, { price: 1850 });
  const candles = await createProduct({
    name: 'Soy Wax Candle Trio',
    category: 'Gifts',
    description: 'Three slow-burning soy candles in reusable glass jars.',
    basePrice: 900,
  });
  return { jacket, candles };
}

describe('copilot tools', () => {
  it('finds products by keyword and respects the budget', async () => {
    await seedCatalog();

    const within2000 = await executeTool(
      'searchProducts',
      { query: 'rainy day gift', maxPrice: 2000 },
      context(),
    );
    const within1000 = await executeTool(
      'searchProducts',
      { query: 'rainy day gift', maxPrice: 1000 },
      context(),
    );

    const names = (within2000.response.results as Row[])
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(['Rain Day Shell Jacket', 'Soy Wax Candle Trio']);
    expect(
      (within1000.response.results as Row[]).map((row) => row.name),
    ).toEqual(['Soy Wax Candle Trio']);
  });

  it('uses the live drop price as the current price', async () => {
    await seedCatalog();

    const outcome = await executeTool(
      'searchProducts',
      { query: 'jacket' },
      context(),
    );
    const [row] = outcome.response.results as Row[];

    expect(row.price).toBe(1850);
    expect(row.status).toBe('live');
  });

  it('returns an explicit empty result when nothing matches', async () => {
    await seedCatalog();

    const outcome = await executeTool(
      'searchProducts',
      { query: 'xylophone' },
      context(),
    );

    expect(outcome.response.count).toBe(0);
    expect(String(outcome.response.note)).toContain('Do not suggest');
  });

  it('builds product cards only for real products', async () => {
    const { jacket } = await seedCatalog();

    const outcome = await executeTool(
      'showProducts',
      { productIds: [jacket.id, newId(), 'not-an-id'] },
      context(),
    );

    expect(outcome.products).toHaveLength(1);
    expect(outcome.products?.[0].name).toBe('Rain Day Shell Jacket');
    expect(outcome.response.shown).toBe(1);
  });

  it('rejects invalid arguments instead of guessing', async () => {
    const outcome = await executeTool(
      'showProducts',
      { productIds: [] },
      context(),
    );
    expect(String(outcome.response.error)).toContain('Invalid arguments');
  });

  it('refuses to add an unknown product to the cart', async () => {
    const ctx = context();

    const outcome = await executeTool(
      'addToCart',
      { productId: newId(), quantity: 1 },
      ctx,
    );

    expect(outcome.response.ok).toBe(false);
    expect(outcome.actions).toBeUndefined();
    expect(await Cart.countDocuments({ user: ctx.userId })).toBe(0);
  });

  it("adds a real product to the signed-in user's own cart", async () => {
    const { jacket } = await seedCatalog();
    const ctx = context();

    const outcome = await executeTool(
      'addToCart',
      { productId: jacket.id, quantity: 1 },
      ctx,
    );
    const cart = await Cart.findOne({ user: ctx.userId }).lean();

    expect(outcome.response.ok).toBe(true);
    expect(outcome.actions).toHaveLength(1);
    expect(cart?.items).toHaveLength(1);
  });

  it('refuses quantities above the limit', async () => {
    const { jacket } = await seedCatalog();

    const outcome = await executeTool(
      'addToCart',
      { productId: jacket.id, quantity: 5 },
      context(),
    );

    expect(outcome.response.ok).toBe(false);
  });

  it('answers unknown tool names without throwing', async () => {
    const outcome = await executeTool('deleteEverything', {}, context());
    expect(String(outcome.response.error)).toContain('Unknown tool');
  });

  it('lists only the drops that are live', async () => {
    await seedCatalog();
    const upcoming = await createProduct({ name: 'Upcoming product' });
    await createDrop(upcoming.id, {
      startsInMs: 3_600_000,
      endsInMs: 7_200_000,
    });

    const outcome = await executeTool('listLiveDrops', {}, context());

    expect(outcome.response.count).toBe(1);
  });
});
