import { type FunctionDeclaration, Type } from '@google/genai';
import { z } from 'zod';
import { listLiveDrops } from '../services/drop.service';
import { addToCart } from '../services/cart.service';
import { MAX_QUANTITY } from '../services/reservation.service';
import { AppError } from '../utils/AppError';
import {
  cardFromDrop,
  currentPrice,
  searchCatalog,
  statusOf,
  toCard,
} from './search';
import type { CopilotAction, ProductCard } from './types';

export interface ToolContext {
  userId: string;
}

export interface ToolOutcome {
  response: Record<string, unknown>;
  trace?: string;
  products?: ProductCard[];
  actions?: CopilotAction[];
}

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'searchProducts',
    description:
      'Search the DropCart catalog. Use short keywords (one to three words) and optionally a maximum current price in taka. Returns real products with their current price and drop status. If nothing matches, try different keywords before giving up.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Short keywords, for example: rain jacket.',
        },
        maxPrice: {
          type: Type.NUMBER,
          description: 'Maximum current price in taka.',
        },
        category: { type: Type.STRING, description: 'Optional category name.' },
      },
    },
  },
  {
    name: 'listLiveDrops',
    description:
      'List the drops that are live right now, with the stock that remains.',
  },
  {
    name: 'addToCart',
    description:
      "Add a product to the user's cart. This does not reserve or buy anything. Only call it when the user clearly asks to add a product.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: {
          type: Type.STRING,
          description:
            'The id of a product returned by searchProducts or listLiveDrops.',
        },
        quantity: {
          type: Type.INTEGER,
          description: 'How many units, 1 or 2. Defaults to 1.',
        },
      },
      required: ['productId'],
    },
  },
];

const searchArgs = z.object({
  query: z.string().trim().max(100).optional(),
  maxPrice: z.number().positive().optional(),
  category: z.string().trim().max(50).optional(),
});

const cartArgs = z.object({
  productId: z.string().trim(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
});

const money = (amount: number) => amount.toLocaleString('en-US');

async function runSearch(args: Record<string, unknown>): Promise<ToolOutcome> {
  const parsed = searchArgs.safeParse(args);
  if (!parsed.success)
    return { response: { error: 'Invalid arguments for searchProducts.' } };

  const items = await searchCatalog(parsed.data);
  const results = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description.slice(0, 140),
    price: currentPrice(item),
    listPrice: item.basePrice,
    status: statusOf(item),
    stockRemaining: item.drop?.stockRemaining ?? null,
  }));

  const budget = parsed.data.maxPrice
    ? `, under ৳${money(parsed.data.maxPrice)}`
    : '';
  const label = parsed.data.query ? `"${parsed.data.query}"` : 'all products';

  return {
    response: {
      count: results.length,
      results,
      ...(results.length === 0
        ? { note: 'No products match. Do not suggest any product.' }
        : {}),
    },
    trace: `Searched the store: ${label}${budget}, ${results.length} found`,
    products: items.slice(0, 4).map(toCard),
  };
}

async function runLiveDrops(): Promise<ToolOutcome> {
  const drops = await listLiveDrops();
  const results = drops.map((drop) => ({
    id: drop.product.id,
    name: drop.product.name,
    price: drop.dropPrice,
    stockRemaining: drop.stockRemaining,
    soldOut: drop.soldOut,
    endsAt: drop.endsAt,
  }));

  return {
    response: { count: results.length, results },
    trace: `Checked live drops, ${results.length} found`,
    products: drops.slice(0, 4).map(cardFromDrop),
  };
}

async function runAddToCart(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const parsed = cartArgs.safeParse(args);
  if (!parsed.success)
    return {
      response: { ok: false, error: 'Invalid arguments for addToCart.' },
    };

  try {
    const added = await addToCart(
      context.userId,
      parsed.data.productId,
      parsed.data.quantity,
    );
    return {
      response: {
        ok: true,
        product: added.name,
        quantity: added.quantity,
        note: 'Added to the cart. Nothing is reserved yet.',
      },
      trace: `Added to cart: ${added.name}`,
      actions: [
        {
          type: 'added_to_cart',
          productId: added.id,
          name: added.name,
          quantity: added.quantity,
        },
      ],
    };
  } catch (error) {
    if (error instanceof AppError)
      return { response: { ok: false, error: error.message } };
    throw error;
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case 'searchProducts':
      return runSearch(args);
    case 'listLiveDrops':
      return runLiveDrops();
    case 'addToCart':
      return runAddToCart(args, context);
    default:
      return { response: { error: `Unknown tool: ${name}` } };
  }
}
