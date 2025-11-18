require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const amqp = require('amqplib');

const url = process.env.RABBITMQ_URL || process.env.CLOUDAMQP_URL ;

(async () => {
    try {
        const conn = await amqp.connect(url);
        const ch = await conn.createChannel();
        const exchange = 'shopping_events';
        await ch.assertExchange(exchange, 'topic', { durable: true });
        const queueName = 'fila_analytics';
        const q = await ch.assertQueue(queueName, { durable: true });
        await ch.bindQueue(q.queue, exchange, 'list.checkout.#');

        console.log('Analytics Worker: aguardando mensagens...');

        ch.consume(q.queue, msg => {
            if (msg !== null) {
                try {
                    const payload = JSON.parse(msg.content.toString());

                    const total = payload.summary && payload.summary.estimatedTotal !== undefined
                        ? payload.summary.estimatedTotal
                        : (payload.items || []).reduce((s, it) => s + ((it.estimatedPrice || 0) * (it.quantity || 0)), 0);

                    console.log(`Analytics Worker: Lista ${payload.listId} total gasto R$ ${total.toFixed(2)}`);
                } catch (err) {
                    console.error('Analytics Worker: erro ao processar mensagem', err);
                }
                ch.ack(msg);
            }
        });
    } catch (err) {
        console.error('Analytics Worker: erro', err);
        process.exit(1);
    }
})();
