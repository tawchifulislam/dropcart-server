import mongoose, { Types } from 'mongoose';
import { connectDb } from '../config/db';
import { Cart } from '../models/Cart';
import { ChatSession } from '../models/ChatSession';
import { Product } from '../models/Product';
import { runCopilot } from '../services/copilot.service';

let failures = 0;

function check(name: string, condition: boolean) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
}

async function run() {
  await connectDb();
  const user = new Types.ObjectId().toString();

  try {
    const unknown = await runCopilot(user, 'Do you have a red leather jacket?');
    console.log(`  reply: ${unknown.text}`);
    check(
      'unknown product shows no product cards',
      unknown.products.length === 0,
    );
    check(
      'reply admits there is no match',
      /\b(no|not|don't|do not|couldn't|could not|unable|unfortunately|isn't|aren't)\b/i.test(
        unknown.text,
      ),
    );

    const gift = await runCopilot(
      user,
      'I need a gift under 2000 taka for a rainy day',
    );
    console.log(`  reply: ${gift.text}`);
    check('gift request returns product cards', gift.products.length > 0);
    check(
      'every card is within the budget',
      gift.products.every((card) => card.price <= 2000),
    );
    const real = await Product.countDocuments({
      _id: { $in: gift.products.map((card) => card.id) },
    });
    check('every card is a real product', real === gift.products.length);

    const added = await runCopilot(user, 'Add the first one to my cart');
    console.log(`  reply: ${added.text}`);
    check('one add to cart action is reported', added.actions.length === 1);
    const cart = await Cart.findOne({ user }).lean();
    const productId = added.actions[0]?.productId;
    check(
      'the cart really contains that product',
      cart?.items.some((item) => item.product.toString() === productId) ===
        true,
    );
  } finally {
    await ChatSession.deleteOne({ user });
    await Cart.deleteOne({ user });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
