const express = require('express');
const request = require('request');
const hbs = require('express-handlebars');
const uuid = require('uuid/v4');



const E_UNABLE_TO_PARSE = 'Bad Request: unable to parse result.';

const defaultClientId = process.env['CLIENT_ID'] || 'DE516D90-B63E-4994-BA64-881EA988A9D2';
const defaultClientSecret = process.env['CLIENT_SECRET'] || process.env.clientSecret;
const defaultPort = process.env['SERVER_PORT'] || process.env.port;
let defaultHost = process.env['WEBSITE_HOSTNAME'] || process.env.host;

function getExpressRoutes({
    oauthRoute = '/oauth-callback',
    tokenRefreshRoute = '/token-refresh',
    renderRoute = '/',
    clientId = defaultClientId,
    clientSecret = defaultClientSecret,
    port = defaultPort,
    host = defaultHost,
}) {
    let hostUri = `https://${host}/`;
    let getFullUriForPath = path => (new URL(path, hostUri)).toString();
    let getCallbackUri = () => getFullUriForPath(oauthRoute);

    // validate critical variables
    if (!clientSecret) {
        throw new Error('Missing CLIENT_SECRET variable!');
    }
    if (!port) {
        throw new Error('Missing PORT variable!');
    }
    if (!host) {
        throw new Error('Missing HOST variable!')
    } else {
        host = process.env.DEV ? host + ':' + port : host;
        console.log('set "host" to', host);
    }

    // propertybag getter & setter
    let getProperty;
    let setProperty;
    // property keys
    const OAUTH_RESULT = 'oauth_result';
    const FORM_DATA = 'form_data';

    // set up middleware for propertybag

    const addPropertyBagMiddleware = (req, res, next) => {
        res.propertyBag = res.propertyBag || {};

        getProperty = key => res.propertyBag[key];
        setProperty = (key, val) => res.propertyBag[key] = val;

        next();
    }

    const getFormBody = (assertion, grantType) => `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&client_assertion=${clientSecret}&grant_type=${grantType}&assertion=${assertion}&redirect_uri=${getCallbackUri()}`;
    const getFormBodyForAuthorization = assertion => getFormBody(assertion, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const getFormBodyForRefresh = assertion => getFormBody(assertion, 'refresh_token');
    const processQuery = (req, res, next) => {
        if (!req.query || !req.query.code) {
            return res.status(400).send('Bad Request: no code parameter in the request!');
        } else {
            next();
        }
    };

    function getAndSetFormDataCallback(callback) {
        return function (req, res, next) {
            let property = callback(req.query.code);
            setProperty(FORM_DATA, property);
            next();
        }
    }

    const handleVstsOauth = (req, res, next) => {
        request.post({
            url: 'https://app.vssps.visualstudio.com/oauth2/token',
            body: getProperty(FORM_DATA),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, (err, response, body) => {
            if (err) {
                res.status(400).send(err);
            } else {
                let result;
                try {
                    result = JSON.parse(body);

                    if (!result) {
                        res.status(400).send(E_UNABLE_TO_PARSE);
                    } else if (result && result.Error) {
                        res.status(400).send(body);
                    } else {
                        // stuff successful result into propertybag
                        setProperty(OAUTH_RESULT, result);
                        next();
                    }
                } catch (e) {
                    res.status(400).send(E_UNABLE_TO_PARSE);
                }
            }
        });
    };


    let oauthCallbacks = [
        processQuery,
        getAndSetFormDataCallback(getFormBodyForAuthorization),
        handleVstsOauth,
        (req, res) => {
            let result = getProperty(OAUTH_RESULT);

            res.render('token', {
                refreshToken: result['refresh_token']
            });
        }
    ];

    let tokenRefreshCallbacks = [
        processQuery,
        getAndSetFormDataCallback(getFormBodyForRefresh),
        handleVstsOauth,
        (req, res) => {
            let result = getProperty(OAUTH_RESULT);
            res.setHeader('Content-Encoding', 'application/json');
            res.status(200).send(result);
        }
    ];

    let renderCallbacks = [(req, res) => {
        res.render('welcome', {
            clientId: clientId,
            state: uuid(),
            redirectUri: getCallbackUri()
        });
    }]

    return {
        middleware: [addPropertyBagMiddleware],
        routes: {
            oauth: {
                route: oauthRoute,
                callbacks: oauthCallbacks,
            },
            tokenRefresh: {
                route: tokenRefreshRoute,
                callbacks: tokenRefreshCallbacks,
            },
            render: {
                route: renderRoute,
                callbacks: renderCallbacks
            }
        }
    }
};

function configureApp(
    app = express(), {
    clientId = defaultClientId,
    clientSecret = defaultClientSecret,
    port = defaultPort,
    host = defaultHost
}) {
    let {
        middleware,
        callbacks
    } = getExpressRoutes({
        clientId,
        clientSecret,
        port,
        host
    });

    app.engine('.hbs', hbs({
        extname: '.hbs'
    }));

    app.set('view engine', '.hbs');
    app.use(...middleware);

    app.get('/oauth-callback', ...callbacks.oauthCallbacks);
    app.get('/token-refresh', ...callbacks.tokenRefreshCallbacks)
    app.get('/', ...callbacks.renderCallbacks);

    return app;
}

configureApp().listen(port, () => {
    console.log(`app listening on port ${port}!`)
});

module.exports = {
    getExpressRoutes,
    configureApp
}