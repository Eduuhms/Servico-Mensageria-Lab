## 🐇 Mensageria com RabbitMQ (15 Pontos)

### 📝 Especificação

O sistema de microsserviços de Lista de Compras (User, List, Item) deve deixar de ser puramente síncrono (HTTP) e passar a suportar eventos assíncronos para operações críticas ou pesadas.

### Cenário de Negócio: "Finalização de Compra"

Quando um usuário finaliza uma lista de compras (`POST /lists/:id/checkout`), o sistema não deve processar tudo na hora (ex: enviar email, calcular estatísticas, baixar estoque).

### Requisitos Técnicos:

1.  **Producer (List Service):** Ao finalizar uma lista, o serviço deve publicar uma mensagem no Exchange `shopping_events` com a routing key `list.checkout.completed`. O endpoint HTTP deve retornar "202 Accepted" imediatamente.
2.  **Consumer A (Log/Notification Service):** Criar um _worker_ simples (pode ser um script Node.js separado) que escuta a fila vinculada a `list.checkout.#`. Ele deve logar no console: _"Enviando comprovante da lista [ID] para o usuário [EMAIL]"_.
3.  **Consumer B (Analytics Service):** Um segundo consumer que escuta a mesma mensagem e calcula o total gasto, simulando uma atualização de dashboard.

### 🎬 Roteiro da Demonstração (Sala de Aula):

1.  **Setup:** Mostrar o RabbitMQ Management (interface web) rodando zerado.
2.  **Disparo:** Fazer uma requisição de Checkout no API Gateway/List Service.
3.  **Evidência:**
    - Mostrar que a API respondeu rápido.
    - Mostrar no terminal do "Consumer" a mensagem de log aparecendo instantaneamente após o disparo.
    - Mostrar no RabbitMQ Management o gráfico de mensagens subindo e descendo (ack).

---
