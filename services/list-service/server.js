const serviceRegistry = require('../../shared/serviceRegistry');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const axios = require('axios');
const JsonDatabase = require('../../shared/JsonDatabase');

class ListService {
    registerWithRegistry() {
        serviceRegistry.register(this.serviceName, {
            url: this.serviceUrl,
            version: '1.0.0',
            database: 'JSON-NoSQL',
            endpoints: ['/health', '/lists', '/lists/:id', '/lists/:id/items', '/lists/:id/summary']
        });
    }

    startHealthReporting() {
        setInterval(() => {
            serviceRegistry.updateHealth(this.serviceName, true);
        }, 30000);
    }
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3003;
        this.serviceName = 'list-service';
        this.serviceUrl = `http://localhost:${this.port}`;
        this.setupDatabase();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupDatabase() {
        const dbPath = path.join(__dirname, 'database');
        this.listsDb = new JsonDatabase(dbPath, 'lists');
        console.log('List Service: Banco NoSQL inicializado');
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

    // Middleware de autenticação 
    authMiddleware(req, res, next) {
        const authHeader = req.header('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Token obrigatório' });
        }
        try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET || 'user-service-secret-key-puc-minas');
            req.user = decoded;
            next();
        } catch (error) {
            console.error('Erro JWT:', error);
            res.status(401).json({ success: false, message: 'Token inválido' });
        }
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', async (req, res) => {
            try {
                const listCount = await this.listsDb.count();
                res.json({
                    service: this.serviceName,
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    version: '1.0.0',
                    database: {
                        type: 'JSON-NoSQL',
                        listCount: listCount
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

        // Criar nova lista
        this.app.post('/lists', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, description } = req.body;
                if (!name) return res.status(400).json({ success: false, message: 'Nome obrigatório' });
                const newList = await this.listsDb.create({
                    id: uuidv4(),
                    userId: req.user.id,
                    name,
                    description: description || '',
                    status: 'active',
                    items: [],
                    summary: {
                        totalItems: 0,
                        purchasedItems: 0,
                        estimatedTotal: 0
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                res.status(201).json({ success: true, data: newList });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao criar lista' });
            }
        });

        // Listar listas do usuário
        this.app.get('/lists', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const lists = await this.listsDb.find({ userId: req.user.id });
                res.json({ success: true, data: lists });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao listar listas' });
            }
        });

        // Buscar lista específica
        this.app.get('/lists/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const list = await this.listsDb.findById(req.params.id);
                if (!list || list.userId !== req.user.id) {
                    return res.status(404).json({ success: false, message: 'Lista não encontrada' });
                }
                res.json({ success: true, data: list });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao buscar lista' });
            }
        });

        // Atualizar lista 
        this.app.put('/lists/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, description } = req.body;
                const list = await this.listsDb.findById(req.params.id);
                if (!list || list.userId !== req.user.id) {
                    return res.status(404).json({ success: false, message: 'Lista não encontrada' });
                }
                const updates = {};
                if (name) updates.name = name;
                if (description) updates.description = description;
                updates.updatedAt = new Date().toISOString();
                const updatedList = await this.listsDb.update(req.params.id, updates);
                res.json({ success: true, data: updatedList });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao atualizar lista' });
            }
        });

        // Deletar lista
        this.app.delete('/lists/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const list = await this.listsDb.findById(req.params.id);
                if (!list || list.userId !== req.user.id) {
                    return res.status(404).json({ success: false, message: 'Lista não encontrada' });
                }
                await this.listsDb.delete(req.params.id);
                res.json({ success: true, message: 'Lista deletada' });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao deletar lista' });
            }
        });

        // Adicionar item à lista
        this.app.post('/lists/:id/items', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { itemId, quantity, notes } = req.body;
                if (!itemId || !quantity) return res.status(400).json({ success: false, message: 'itemId e quantity obrigatórios' });
                const list = await this.listsDb.findById(req.params.id);
                if (!list || list.userId !== req.user.id) {
                    return res.status(404).json({ success: false, message: 'Lista não encontrada' });
                }
                // Buscar dados do item no Item Service
                const itemServiceUrl = process.env.ITEM_SERVICE_URL || 'http://localhost:3002';
                const itemResp = await axios.get(`${itemServiceUrl}/items/${itemId}`);
                const itemData = itemResp.data.data;
                const listItem = {
                    itemId: itemData.id,
                    itemName: itemData.name,
                    quantity: Number(quantity),
                    unit: itemData.unit,
                    estimatedPrice: itemData.averagePrice,
                    purchased: false,
                    notes: notes || '',
                    addedAt: new Date().toISOString()
                };
                list.items.push(listItem);
                this.recalculateSummary(list);
                list.updatedAt = new Date().toISOString();
                const updatedList = await this.listsDb.update(list.id, list);
                res.status(201).json({ success: true, data: updatedList });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao adicionar item à lista' });
            }
        });

        // Atualizar item na lista
        this.app.put('/lists/:id/items/:itemId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { quantity, purchased, notes } = req.body;
                const list = await this.listsDb.findById(req.params.id);
                if (!list || list.userId !== req.user.id) {
                    return res.status(404).json({ success: false, message: 'Lista não encontrada' });
                }
                const item = list.items.find(i => i.itemId === req.params.itemId);
                if (!item) return res.status(404).json({ success: false, message: 'Item não encontrado na lista' });
                if (quantity !== undefined) item.quantity = Number(quantity);
                if (purchased !== undefined) item.purchased = !!purchased;
                if (notes !== undefined) item.notes = notes;
                this.recalculateSummary(list);
                list.updatedAt = new Date().toISOString();
                const updatedList = await this.listsDb.update(list.id, list);
                res.json({ success: true, data: updatedList });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao atualizar item na lista' });
            }
        });

        // Remover item da lista
        this.app.delete('/lists/:id/items/:itemId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const list = await this.listsDb.findById(req.params.id);
                if (!list || list.userId !== req.user.id) {
                    return res.status(404).json({ success: false, message: 'Lista não encontrada' });
                }
                const idx = list.items.findIndex(i => i.itemId === req.params.itemId);
                if (idx === -1) return res.status(404).json({ success: false, message: 'Item não encontrado na lista' });
                list.items.splice(idx, 1);
                this.recalculateSummary(list);
                list.updatedAt = new Date().toISOString();
                const updatedList = await this.listsDb.update(list.id, list);
                res.json({ success: true, data: updatedList });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao remover item da lista' });
            }
        });

        // Resumo da lista
        this.app.get('/lists/:id/summary', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const list = await this.listsDb.findById(req.params.id);
                if (!list || list.userId !== req.user.id) {
                    return res.status(404).json({ success: false, message: 'Lista não encontrada' });
                }
                this.recalculateSummary(list);
                res.json({ success: true, data: list.summary });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Erro ao obter resumo da lista' });
            }
        });
    }

    recalculateSummary(list) {
        const totalItems = list.items.length;
        const purchasedItems = list.items.filter(i => i.purchased).length;
        const estimatedTotal = list.items.reduce((sum, i) => sum + (i.estimatedPrice * i.quantity), 0);
        list.summary = {
            totalItems,
            purchasedItems,
            estimatedTotal
        };
    }

    setupErrorHandling() {
        this.app.use('*', (req, res) => {
            res.status(404).json({ success: false, message: 'Endpoint não encontrado', service: this.serviceName });
        });
        this.app.use((error, req, res, next) => {
            console.error('List Service Error:', error);
            res.status(500).json({ success: false, message: 'Erro interno do serviço', service: this.serviceName });
        });
    }

    start() {
        this.app.listen(this.port, () => {
            console.log('=====================================');
            console.log(`List Service iniciado na porta ${this.port}`);
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
    const listService = new ListService();
    listService.start();

    // Cleanup automático ao encerrar
    process.on('SIGTERM', () => {
        serviceRegistry.unregister('list-service');
        process.exit(0);
    });
    process.on('SIGINT', () => {
        serviceRegistry.unregister('list-service');
        process.exit(0);
    });
}

module.exports = ListService;
