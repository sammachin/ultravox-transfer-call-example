require('dotenv').config();
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const server = createServer();
const makeService = createEndpoint({server});
const logger = require('pino')({level: process.env.LOGLEVEL || 'info'});
const port = process.env.WS_PORT || 3000;


const service = ({logger, makeService}) => {
    const svc = makeService({path: '/transfer-call'});
  
    svc.on('session:new', (session) => {

        session.locals = {logger: logger.child({call_sid: session.call_sid})};
        logger.info({session}, `new incoming call: ${session.call_sid}`);
  
        const apiKey = process.env.ULTRAVOX_API_KEY;
  
        try {
            session
                .on('/event', onEvent.bind(null, session))
                .on('/final', onFinal.bind(null, session))
                .on('close', onClose.bind(null, session))
                .on('error', onError.bind(null, session));
        
            session
                .pause({length: 1.5})
                .llm({
                    vendor: 'ultravox',
                    model: 'fixie-ai/ultravox',
                    auth: {
                        apiKey
                    },
                    actionHook: '/final',
                    eventHook: '/event',
                    llmOptions: {
                        systemPrompt: 'You are an agent named Karen. Greet the user and ask how you can help.',
                        firstSpeaker: 'FIRST_SPEAKER_AGENT',
                        initialMessages: [{
                            medium: 'MESSAGE_MEDIUM_VOICE',
                            role: 'MESSAGE_ROLE_USER'
                        }],
                        model: 'fixie-ai/ultravox',
                        voice: 'Tanya-English',
                        transcriptOptional: true,
                    }
                })
                .hangup()
                .send();
        } catch (err) {
          session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
          session.close();
        }
    });
};

const onEvent = async(session, evt) => {
    const {logger} = session.locals;
    logger.info(`got eventHook: ${JSON.stringify(evt)}`);
};

const onFinal = async(session, evt) => {
    const {logger} = session.locals;
    logger.info(`got actionHook: ${JSON.stringify(evt)}`);

    if (['server failure', 'server error'].includes(evt.completion_reason)) {
        if (evt.error.code === 'rate_limit_exceeded') {
            let text = 'Sorry, you have exceeded your  rate limits. ';
            const arr = /try again in (\d+)/.exec(evt.error.message);
            if (arr) {
                text += `Please try again in ${arr[1]} seconds.`;
            }
            session
                .say({text});
        }
        else {
            session
                .say({text: 'Sorry, there was an error processing your request.'});
        }
        session.hangup();
    }
    session.reply();
};

const onClose = (session, code, reason) => {
    const {logger} = session.locals;
    logger.info({session, code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
    const {logger} = session.locals;
    logger.info({err}, `session ${session.call_sid} received error`);
};

module.exports = service;
service({logger, makeService});  

server.listen(port, () => {
    logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});