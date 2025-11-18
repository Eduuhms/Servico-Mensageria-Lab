require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const amqp = require('amqplib');

const url = process.env.RABBITMQ_URL || process.env.CLOUDAMQP_URL ;

(async () => {
    try {
        const conn = await amqp.connect(url);
        const ch = await conn.createChannel();
        const exchange = 'shopping_events';
        await ch.assertExchange(exchange, 'topic', { durable: true });
        const queueName = 'fila_notificacao';
        const q = await ch.assertQueue(queueName, { durable: true });
        await ch.bindQueue(q.queue, exchange, 'list.checkout.#');

        console.log('Notification Worker: aguardando mensagens...');

        ch.consume(q.queue, msg => {
            if (msg !== null) {
                try {
                    const payload = JSON.parse(msg.content.toString());
                    console.log(`Enviando comprovante da lista ${payload.listId} para o usuário ${payload.userEmail}`);
                } catch (err) {
                    console.error('Notification Worker: erro ao processar mensagem', err);
                }
                ch.ack(msg);
            }
        });
    } catch (err) {
        console.error('Notification Worker: erro', err);
        process.exit(1);
    }
})();
