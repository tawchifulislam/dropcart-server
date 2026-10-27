import { Product, ProductRecord } from '../models/Product';
import { attachActiveDrops, listLiveDrops } from '../services/drop.service';
import { escapeRegExp } from '../utils/text';
import type { ProductCard } from './types';

type CatalogItem = Awaited<ReturnType<typeof attachActiveDrops>>[number];
type LiveDrop = Awaited<ReturnType<typeof listLiveDrops>>[number];

const CANDIDATE_LIMIT = 40;
const RESULT_LIMIT = 6;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'under',
  'below',
  'over',
  'some',
  'something',
  'want',
  'need',
  'have',
  'you',
  'any',
  'can',
  'show',
  'find',
  'looking',
  'best',
  'good',
  'nice',
  'day',
  'please',
  'get',
  'buy',
  'cheap',
  'cheaper',
]);

const stem = (word: string) =>
  word.length > 4 ? word.replace(/(ing|ed|es|s|y)$/, '') : word;

function keywords(query?: string) {
  const words = query?.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const useful = words.filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word),
  );
  return [...new Set(useful.map(stem))];
}

export const currentPrice = (item: CatalogItem) =>
  item.drop && item.drop.status !== 'ended'
    ? item.drop.dropPrice
    : item.basePrice;

export function statusOf(item: CatalogItem): ProductCard['status'] {
  if (!item.drop || item.drop.status === 'ended') return 'no_drop';
  if (item.drop.soldOut) return 'sold_out';
  return item.drop.status === 'live' ? 'live' : 'upcoming';
}

export function toCard(item: CatalogItem): ProductCard {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    image: item.images[0],
    category: item.category,
    price: currentPrice(item),
    basePrice: item.basePrice,
    status: statusOf(item),
    stockRemaining: item.drop?.stockRemaining,
    dropId: item.drop?.id,
  };
}

export function cardFromDrop(drop: LiveDrop): ProductCard {
  return {
    id: drop.product.id,
    name: drop.product.name,
    slug: drop.product.slug,
    image: drop.product.images[0],
    category: drop.product.category,
    price: drop.dropPrice,
    basePrice: drop.product.basePrice,
    status: drop.soldOut ? 'sold_out' : 'live',
    stockRemaining: drop.stockRemaining,
    dropId: drop.id,
  };
}

interface SearchInput {
  query?: string;
  maxPrice?: number;
  category?: string;
}

export async function searchCatalog({
  query,
  maxPrice,
  category,
}: SearchInput) {
  const words = keywords(query);
  const filter: Record<string, unknown> = {};

  if (category)
    filter.category = new RegExp(`^${escapeRegExp(category)}$`, 'i');
  if (words.length > 0) {
    const patterns = words.map((word) => new RegExp(escapeRegExp(word), 'i'));
    filter.$or = patterns.flatMap((pattern) => [
      { name: pattern },
      { category: pattern },
      { description: pattern },
    ]);
  }

  const products = await Product.find(filter)
    .limit(CANDIDATE_LIMIT)
    .lean<ProductRecord[]>();
  const items = await attachActiveDrops(products);

  const score = (item: CatalogItem) =>
    words.reduce(
      (total, word) =>
        total +
        (item.name.toLowerCase().includes(word) ? 3 : 0) +
        (item.category.toLowerCase().includes(word) ? 2 : 0) +
        (item.description.toLowerCase().includes(word) ? 1 : 0),
      0,
    );

  return items
    .filter((item) => maxPrice === undefined || currentPrice(item) <= maxPrice)
    .sort((a, b) => score(b) - score(a))
    .slice(0, RESULT_LIMIT);
}
