# Servico-Mensageria-Lab

Este repositório contém um conjunto de microserviços para uma aplicação de Lista de Compras (User, List, Item) e workers que processam eventos via RabbitMQ (CloudAMQP).

## Variáveis de ambiente

Coloque a URL do RabbitMQ/CloudAMQP no arquivo `.env` na raiz do projeto. 

## Instalação (dependências)

Na raiz do projeto instale dependências gerais e das subpastas:

```powershell
cd C:\Users\eduado\Desktop\servicoMensageria
npm install

# Instalar dependências locais das services (opcional se preferir usar npm install na raiz que já instala as dependências listadas)
cd services\user-service
npm install
cd ..\list-service
npm install
cd ..\item-service
npm install
cd ..\..   # volta para a raiz
```

## Rodando os microserviços


# User Service
```powershell
cd C:\Users\eduado\Desktop\servicoMensageria\services\user-service
npm start
```

# List Service
```powershell
cd C:\Users\eduado\Desktop\servicoMensageria\services\list-service
npm start
```

# Item Service
```powershell
cd C:\Users\eduado\Desktop\servicoMensageria\services\item-service
npm start
```

## Rodando os workers (consumers)

Os workers ficam na pasta `workers`. 

```powershell
cd C:\Users\eduado\Desktop\servicoMensageria
npm run worker:notification
npm run worker:analytics
```

Cada worker conecta ao broker definido em `CLOUDAMQP_URL` e consome as filas:
- `fila_notificacao` (worker de notificação)
- `fila_analytics` (worker de analytics)
