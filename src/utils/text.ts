const OBJECT_ID = /^[a-f\d]{24}$/i;

export const isObjectId = (value: string) => OBJECT_ID.test(value);

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
