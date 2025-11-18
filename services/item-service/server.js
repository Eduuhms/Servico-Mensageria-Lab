const serviceRegistry = require('../../shared/serviceRegistry');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const JsonDatabase = require('../../shared/JsonDatabase');

class ItemService {
    registerWithRegistry() {
        serviceRegistry.register(this.serviceName, {
            url: this.serviceUrl,
            version: '1.0.0',
            database: 'JSON-NoSQL',
            endpoints: ['/health', '/categories', '/items', '/items/:id', '/search']
        });
    }

    startHealthReporting() {
        setInterval(() => {
            serviceRegistry.updateHealth(this.serviceName, true);
        }, 30000);
    }
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3002;
        this.serviceName = 'item-service';
        this.serviceUrl = `http://localhost:${this.port}`;
        this.categories = [
            'Alimentos',
            'Limpeza',
            'Higiene',
            'Bebidas',
            'Padaria'
        ];
        this.setupDatabase();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupDatabase() {
        const dbPath = path.join(__dirname, 'database');
    this.itemsDb = new JsonDatabase(dbPath, 'items');
    console.log('Item Service: Banco NoSQL inicializado');
    }

    setupMiddleware() {
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(morgan('combined'));
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use((req, res, next) => {
            res.setHeader('X-Service', this.serviceName);
            res.setHeader('X-Service-Version', '1.0.0');
            res.setHeader('X-Database', 'JSON-NoSQL');
            next();
        });
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', async (req, res) => {
            try {
                const itemCount = await this.itemsDb.count();
                res.json({
                    service: this.serviceName,
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    version: '1.0.0',
                    database: {
                        type: 'JSON-NoSQL',
                        itemCount: itemCount
                    }
                });
            } catch (error) {
                res.status(503).json({
                    service: this.serviceName,
                    status: 'unhealthy',
                    error: error.message
                });
            }
        });

        // Listar categorias
        this.app.get('/categories', (req, res) => {
            res.json({
                success: true,
                data: this.categories
            });
        });



        // Listar itens com filtros
        this.app.get('/items', async (req, res) => {
            try {
                const { category, name } = req.query;
                let filter = {};
                if (category) filter.category = category;
                if (name) filter.name = { $regex: name, $options: 'i' };
                const items = await this.itemsDb.find(filter);
                res.json({ success: true, data: items });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao listar itens' });
            }
        });



        // Buscar item específico
        this.app.get('/items/:id', async (req, res) => {
            try {
                const item = await this.itemsDb.findById(req.params.id);
                if (!item) {
                    return res.status(404).json({ success: false, message: 'Item não encontrado' });
                }
                res.json({ success: true, data: item });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao buscar item' });
            }
        });

        // Buscar itens por nome 
        this.app.get('/search', async (req, res) => {
            try {
                const { q } = req.query;
                if (!q) return res.status(400).json({ success: false, message: 'Query obrigatória' });
                const items = await this.itemsDb.find({ name: { $regex: q, $options: 'i' } });
                res.json({ success: true, data: items });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro na busca' });
            }
        });



        // Criar novo item (requer autenticação)
        this.app.post('/items', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, category, brand, unit, averagePrice, barcode, description, active } = req.body;
                if (!name || !category || !brand || !unit || !averagePrice || !barcode) {
                    return res.status(400).json({ success: false, message: 'Campos obrigatórios faltando' });
                }
                if (!this.categories.includes(category)) {
                    return res.status(400).json({ success: false, message: 'Categoria inválida' });
                }
                const newItem = await this.itemsDb.create({
                    id: uuidv4(),
                    name,
                    category,
                    brand,
                    unit,
                    averagePrice: Number(averagePrice),
                    barcode,
                    description: description || '',
                    active: active !== undefined ? !!active : true,
                    createdAt: new Date().toISOString()
                });
                res.status(201).json({ success: true, data: newItem });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao criar item' });
            }
        });



        // Atualizar item
        this.app.put('/items/:id', async (req, res) => {
            try {
                const updates = req.body;
                const item = await this.itemsDb.findById(req.params.id);
                if (!item) {
                    return res.status(404).json({ success: false, message: 'Item não encontrado' });
                }
                if (updates.category && !this.categories.includes(updates.category)) {
                    return res.status(400).json({ success: false, message: 'Categoria inválida' });
                }
                const updatedItem = await this.itemsDb.update(req.params.id, updates);
                res.json({ success: true, data: updatedItem });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao atualizar item' });
            }
        });
    }

    setupErrorHandling() {
        this.app.use('*', (req, res) => {
            res.status(404).json({ success: false, message: 'Endpoint não encontrado', service: this.serviceName });
        });
        this.app.use((error, req, res, next) => {
            console.error('Item Service Error:', error);
            res.status(500).json({ success: false, message: 'Erro interno do serviço', service: this.serviceName });
        });
    }

    // Middleware de autenticação 
    authMiddleware(req, res, next) {
        const authHeader = req.header('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Token obrigatório' });
        }
        next();
    }

    start() {
        this.app.listen(this.port, () => {
            console.log('=====================================');
            console.log(`Item Service iniciado na porta ${this.port}`);
            console.log(`URL: ${this.serviceUrl}`);
            console.log(`Health: ${this.serviceUrl}/health`);
            console.log(`Database: JSON-NoSQL`);
            console.log('=====================================');
            this.registerWithRegistry();
            this.startHealthReporting();
        });
    }
}


if (require.main === module) {
    const itemService = new ItemService();
    itemService.start();

    // Cleanup automático ao encerrar
    process.on('SIGTERM', () => {
        serviceRegistry.unregister('item-service');
        process.exit(0);
    });
    process.on('SIGINT', () => {
        serviceRegistry.unregister('item-service');
        process.exit(0);
    });
}

module.exports = ItemService;
