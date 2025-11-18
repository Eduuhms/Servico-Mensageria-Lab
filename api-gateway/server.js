const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios');
const serviceRegistry = require('../shared/serviceRegistry');

const app = express();
const port = process.env.PORT || 3000;

// Circuit breaker state
const circuitBreaker = {
  'user-service': { failures: 0, open: false, lastFail: null },
  'item-service': { failures: 0, open: false, lastFail: null },
  'list-service': { failures: 0, open: false, lastFail: null }
};
const MAX_FAILURES = 3;
const CIRCUIT_TIMEOUT = 60000; // 1 min

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Service discovery helper
function getServiceUrl(serviceName) {
  try {
    const service = serviceRegistry.discover(serviceName);
    return service.url;
  } catch (err) {
    return null;
  }
}

// Circuit breaker helper
function canRequest(serviceName) {
  const state = circuitBreaker[serviceName];
  if (!state) return true;
  if (!state.open) return true;
  // Check if timeout expired
  if (Date.now() - state.lastFail > CIRCUIT_TIMEOUT) {
    state.open = false;
    state.failures = 0;
    return true;
  }
  return false;
}
function recordFailure(serviceName) {
  const state = circuitBreaker[serviceName];
  if (!state) return;
  state.failures++;
  if (state.failures >= MAX_FAILURES) {
    state.open = true;
    state.lastFail = Date.now();
    console.warn(`Circuit breaker OPEN for ${serviceName}`);
  }
}
function recordSuccess(serviceName) {
  const state = circuitBreaker[serviceName];
  if (!state) return;
  state.failures = 0;
  state.open = false;
}

// Proxy handler
function getTargetPath(req, pathPrefix) {
  // Remove apenas o prefixo exato do início da URL
  if (req.originalUrl.startsWith(pathPrefix)) {
    let newPath = req.originalUrl.slice(pathPrefix.length);
    // Se ficou vazio, retorna o path base do serviço
    if (newPath === '' || newPath === '/') {
      return pathPrefix.replace('/api', '');
    }
    if (!newPath.startsWith('/')) newPath = '/' + newPath;
    return pathPrefix.replace('/api', '') + newPath;
  }
  return req.originalUrl;
}

async function proxyRequest(serviceName, req, res, pathPrefix) {
  if (!canRequest(serviceName)) {
    return res.status(503).json({ success: false, message: `Serviço temporariamente indisponível (circuit breaker)` });
  }
  const baseUrl = getServiceUrl(serviceName);
  if (!baseUrl) {
    return res.status(503).json({ success: false, message: `Serviço não encontrado: ${serviceName}` });
  }
  const targetPath = getTargetPath(req, pathPrefix);
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  // Garante que targetPath sempre começa com /
  const cleanTargetPath = targetPath.startsWith('/') ? targetPath : '/' + targetPath;
  const targetUrl = cleanBaseUrl + cleanTargetPath;
  try {
    console.log(`[API-GW] ${req.method} ${req.originalUrl} => ${targetUrl}`);
    // Remove headers que podem causar problemas
    const { host, 'content-length': _cl, ...forwardHeaders } = req.headers;
    // Só envia body em métodos que aceitam
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase());
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders
    };
    if (hasBody) axiosConfig.data = req.body;
    const response = await axios(axiosConfig);
    console.log(`[API-GW] ${targetUrl} -> ${response.status}`);
    recordSuccess(serviceName);
    res.status(response.status).json(response.data);
  } catch (error) {
    recordFailure(serviceName);
    if (error.response) {
      console.log(`[API-GW] ${targetUrl} -> ${error.response.status}`);
      res.status(error.response.status).json(error.response.data);
    } else {
      console.log(`[API-GW] ${targetUrl} -> 500`);
      res.status(500).json({ success: false, message: 'Erro ao encaminhar requisição' });
    }
  }
}

// Roteamento reverso
app.all('/api/auth*', (req, res) => proxyRequest('user-service', req, res, '/api/auth'));
app.all('/api/users*', (req, res) => proxyRequest('user-service', req, res, '/api/users'));
app.all('/api/items*', (req, res) => proxyRequest('item-service', req, res, '/api/items'));
app.all('/api/lists*', (req, res) => proxyRequest('list-service', req, res, '/api/lists'));

// Health check de todos os serviços
app.get('/health', async (req, res) => {
  const services = ['user-service', 'item-service', 'list-service'];
  const results = {};
  for (const name of services) {
    try {
      const url = getServiceUrl(name);
      if (!url) throw new Error('Não encontrado');
      const resp = await axios.get(url + '/health');
      results[name] = resp.data;
    } catch (e) {
      results[name] = { status: 'unhealthy', error: e.message };
    }
  }
  res.json(results);
});

// Registry
app.get('/registry', (req, res) => {
  res.json(serviceRegistry.listServices());
});

// Health checks automáticos
setInterval(() => {
  try {
    serviceRegistry.performHealthChecks();
  } catch (e) {
    console.error('Erro no health check automático:', e);
  }
}, 30000);


// Middleware JWT para endpoints agregados
const jwt = require('jsonwebtoken');
function jwtAuthMiddleware(req, res, next) {
  const authHeader = req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token obrigatório' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'user-service-secret-key-puc-minas');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token inválido' });
  }
}

// /api/dashboard
app.get('/api/dashboard', jwtAuthMiddleware, async (req, res) => {
  try {
    const userUrl = getServiceUrl('user-service');
    const listUrl = getServiceUrl('list-service');
    const itemUrl = getServiceUrl('item-service');
    if (!userUrl || !listUrl || !itemUrl) {
      return res.status(503).json({ success: false, message: 'Serviços indisponíveis' });
    }
    // Buscar dados do usuário
    const userResp = await axios.get(`${userUrl}/users/${req.user.id}`, {
      headers: { Authorization: req.header('Authorization') }
    });
    const user = userResp.data.data;
    // Buscar listas do usuário
    const listsResp = await axios.get(`${listUrl}/lists`, {
      headers: { Authorization: req.header('Authorization') }
    });
    const lists = listsResp.data.data || [];
    // Buscar todos os itens
    const itemsResp = await axios.get(`${itemUrl}/items`);
    const items = itemsResp.data.data || [];

    // Estatísticas
    const totalLists = lists.length;
    const totalItemsInLists = lists.reduce((sum, l) => sum + (l.items?.length || 0), 0);
    const totalPurchased = lists.reduce((sum, l) => sum + (l.items?.filter(i => i.purchased).length || 0), 0);
    const totalEstimated = lists.reduce((sum, l) => sum + (l.summary?.estimatedTotal || 0), 0);
    const totalCatalogItems = items.length;

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        },
        stats: {
          totalLists,
          totalItemsInLists,
          totalPurchased,
          totalEstimated,
          totalCatalogItems
        },
        lists
      }
    });
  } catch (error) {
    console.error('Erro no dashboard:', error.message);
    res.status(500).json({ success: false, message: 'Erro ao agregar dados do dashboard' });
  }
});


// /api/search
app.get('/api/search', jwtAuthMiddleware, async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ success: false, message: 'Query obrigatória (?q=termo)' });
  try {
    const listUrl = getServiceUrl('list-service');
    const itemUrl = getServiceUrl('item-service');
    if (!listUrl || !itemUrl) {
      return res.status(503).json({ success: false, message: 'Serviços indisponíveis' });
    }
    // Buscar listas do usuário
    const listsResp = await axios.get(`${listUrl}/lists`, {
      headers: { Authorization: req.header('Authorization') }
    });
    const lists = listsResp.data.data || [];
    // Filtrar listas por nome/descrição
    const filteredLists = lists.filter(l =>
      (l.name && l.name.toLowerCase().includes(q.toLowerCase())) ||
      (l.description && l.description.toLowerCase().includes(q.toLowerCase()))
    );
    // Buscar itens por nome
    const itemsResp = await axios.get(`${itemUrl}/search?q=${encodeURIComponent(q)}`);
    const items = itemsResp.data.data || [];
    res.json({
      success: true,
      data: {
        lists: filteredLists,
        items
      }
    });
  } catch (error) {
    console.error('Erro no search:', error.message);
    res.status(500).json({ success: false, message: 'Erro ao buscar dados globais' });
  }
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint não encontrado (API Gateway)' });
});

app.listen(port, () => {
  console.log('=====================================');
  console.log(`API Gateway iniciado na porta ${port}`);
  console.log('=====================================');
});
