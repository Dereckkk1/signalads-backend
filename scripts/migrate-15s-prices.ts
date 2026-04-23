/**
 * Script de migração: Atualiza preços de produtos "Comercial 15s"
 * para 75% do preço do "Comercial 30s" correspondente (mesma emissora).
 *
 * Uso: cd signalads-backend && npx ts-node src/scripts/migrate-15s-prices.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const productSchema = new mongoose.Schema({
  broadcasterId: mongoose.Schema.Types.ObjectId,
  spotType: String,
  duration: Number,
  pricePerInsertion: Number,
  netPrice: Number,
  manuallyEdited: Boolean,
  isActive: Boolean,
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI não definida no .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Conectado ao MongoDB');

  // Busca todos os produtos 30s comerciais
  const products30s = await Product.find({ spotType: 'Comercial 30s' });
  console.log(`Encontrados ${products30s.length} produtos "Comercial 30s"`);

  let updated = 0;
  let skipped = 0;

  for (const p30 of products30s) {
    const p15 = await Product.findOne({
      broadcasterId: p30.broadcasterId,
      spotType: 'Comercial 15s',
    });

    if (!p15) {
      skipped++;
      continue;
    }

    const oldPrice = p15.pricePerInsertion;
    const newPrice = Math.round(p30.pricePerInsertion! * 0.75 * 100) / 100;

    if (oldPrice === newPrice) {
      skipped++;
      continue;
    }

    await Product.updateOne(
      { _id: p15._id },
      { pricePerInsertion: newPrice, manuallyEdited: true }
    );

    console.log(
      `  Emissora ${p30.broadcasterId}: 15s R$${oldPrice} → R$${newPrice} (30s = R$${p30.pricePerInsertion})`
    );
    updated++;
  }

  console.log(`\nResultado: ${updated} atualizados, ${skipped} sem alteração`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Erro na migração:', err);
  process.exit(1);
});
