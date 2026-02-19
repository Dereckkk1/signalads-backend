import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import connectDB from './config/database';
import { User } from './models/User';

dotenv.config();

const testDatabase = async () => {
  try {
    console.log('🔌 Conectando ao MongoDB...');
    await connectDB();
    console.log('✅ Conectado ao MongoDB!');

    // 1. Verificar se existem usuários
    console.log('\n📊 Verificando usuários existentes...');
    const allUsers = await User.find({});
    console.log(`Total de usuários: ${allUsers.length}`);
    
    allUsers.forEach(user => {
      console.log(`  - ${user.email} (${user.userType}, status: ${user.status})`);
    });

    // 2. Verificar emissoras pendentes
    console.log('\n⏳ Verificando emissoras pendentes...');
    const pendingBroadcasters = await User.find({ 
      userType: 'broadcaster', 
      status: 'pending' 
    });
    console.log(`Total de emissoras pendentes: ${pendingBroadcasters.length}`);
    
    pendingBroadcasters.forEach(broadcaster => {
      console.log(`  - ${broadcaster.companyName || broadcaster.email}`);
      console.log(`    Email: ${broadcaster.email}`);
      console.log(`    CNPJ: ${broadcaster.cpfOrCnpj}`);
      console.log(`    Status: ${broadcaster.status}`);
    });

    // 3. Criar admin de teste (se não existir)
    console.log('\n👤 Verificando admin...');
    const adminEmail = 'admin@E-rádios.com';
    let admin = await User.findOne({ email: adminEmail });
    
    if (!admin) {
      console.log('⚙️  Criando admin de teste...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      admin = await User.create({
        email: adminEmail,
        password: hashedPassword,
        userType: 'admin',
        status: 'approved',
        cpfOrCnpj: '00000000000191',
        companyName: 'E-rádios Admin'
      });
      console.log('✅ Admin criado!');
      console.log(`   Email: ${adminEmail}`);
      console.log(`   Senha: admin123`);
    } else {
      console.log(`✅ Admin já existe: ${admin.email}`);
    }

    // 4. Criar emissora de teste (se não existir)
    console.log('\n📻 Verificando emissora de teste...');
    const broadcasterEmail = 'teste@radio.com';
    let broadcaster = await User.findOne({ email: broadcasterEmail });
    
    if (!broadcaster) {
      console.log('⚙️  Criando emissora de teste...');
      const hashedPassword = await bcrypt.hash('radio123', 10);
      broadcaster = await User.create({
        email: broadcasterEmail,
        password: hashedPassword,
        userType: 'broadcaster',
        status: 'pending',
        cpfOrCnpj: '12345678000195',
        companyName: 'Rádio Teste FM',
        fantasyName: 'Rádio Teste',
        phone: '(11) 98765-4321',
        address: {
          cep: '01310-100',
          street: 'Av. Paulista',
          number: '1000',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP'
        }
      });
      console.log('✅ Emissora de teste criada!');
      console.log(`   Email: ${broadcasterEmail}`);
      console.log(`   Senha: radio123`);
      console.log(`   Status: pending`);
    } else {
      console.log(`✅ Emissora já existe: ${broadcaster.email} (status: ${broadcaster.status})`);
    }

    // 5. Verificar novamente o total
    console.log('\n📊 Resumo Final:');
    const finalCount = await User.countDocuments({});
    const pendingCount = await User.countDocuments({ userType: 'broadcaster', status: 'pending' });
    const approvedCount = await User.countDocuments({ userType: 'broadcaster', status: 'approved' });
    
    console.log(`  Total de usuários: ${finalCount}`);
    console.log(`  Emissoras pendentes: ${pendingCount}`);
    console.log(`  Emissoras aprovadas: ${approvedCount}`);

    console.log('\n✅ Teste completo!');
    console.log('\n📝 Para testar:');
    console.log('   1. Login como admin: admin@E-rádios.com / admin123');
    console.log('   2. Login como emissora: teste@radio.com / radio123');
    console.log('   3. Acesse /admin para aprovar a emissora de teste');

  } catch (error) {
    console.error('❌ Erro no teste:', error);
  } finally {
    process.exit(0);
  }
};

testDatabase();
