import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    const nodeEnv = process.env.NODE_ENV || 'development';

    if (!mongoUri) {
      throw new Error('MONGODB_URI não está definida no arquivo .env');
    }

    // Identifica o banco para o log (sem mostrar a senha)
    console.log(`📡 Conectando ao MongoDB [Ambiente: ${nodeEnv}]...`);

    await mongoose.connect(mongoUri);

    console.log(`✅ MongoDB Conectado com sucesso [${nodeEnv}]`);

  } catch (error) {
    console.error('❌ Erro ao conectar ao MongoDB:', error);
    process.exit(1);
  }
};

export default connectDB;
