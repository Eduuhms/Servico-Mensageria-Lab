const axios = require('axios');

async function testUserService() {
    const baseUrl = 'http://localhost:3001';
    
    console.log('🧪 Testando User Service...\n');
    
    try {
        // 1. Health Check
        console.log('1. Health Check:');
        const healthResponse = await axios.get(`${baseUrl}/health`);
        console.log('✅ Status:', healthResponse.data.status);
        console.log('   User Count:', healthResponse.data.database.userCount);
        console.log('');
        
        // 2. Registrar usuário
        console.log('2. Registrando usuário:');
        const registerData = {
            email: `test${Date.now()}@email.com`,
            username: `user${Date.now()}`,
            password: 'test123',
            firstName: 'Test',
            lastName: 'User',
            preferences: {
                defaultStore: 'Loja Teste',
                currency: 'BRL'
            }
        };
        
        const registerResponse = await axios.post(`${baseUrl}/auth/register`, registerData);
        console.log('✅ Usuário registrado:', registerResponse.data.data.user.username);
        const token = registerResponse.data.data.token;
        console.log('   Token:', token.substring(0, 20) + '...');
        console.log('');
        
        // 3. Fazer login
        console.log('3. Fazendo login:');
        const loginResponse = await axios.post(`${baseUrl}/auth/login`, {
            identifier: registerData.email,
            password: registerData.password
        });
        console.log('✅ Login realizado:', loginResponse.data.message);
        console.log('');
        
        // 4. Buscar usuário
        console.log('4. Buscando usuário:');
        const userId = registerResponse.data.data.user.id;
        const userResponse = await axios.get(`${baseUrl}/users/${userId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('✅ Usuário encontrado:', userResponse.data.data.firstName, userResponse.data.data.lastName);
        console.log('   Email:', userResponse.data.data.email);
        console.log('   Store:', userResponse.data.data.preferences.defaultStore);
        console.log('');
        
        console.log('🎉 Todos os testes passaram! User Service está funcionando.');
        
    } catch (error) {
        console.error('❌ Erro no teste:', error.response?.data || error.message);
    }
}

// Executar teste
testUserService().catch(console.error);