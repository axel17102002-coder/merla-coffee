// Adaptador Cloudflare ⇄ los handlers de backend/functions/.
// Convierte el Request de Cloudflare al `event` que esperan los handlers
// (estilo función serverless) y su respuesta {statusCode, headers, body} a un
// Response. Es la única pieza que conoce el formato de Cloudflare.

export function adaptar(handler) {
  return async (context) => {
    // En Workers las variables de entorno llegan por request en context.env;
    // las volcamos a process.env para que el código compartido las encuentre.
    if (typeof globalThis.process === "undefined") globalThis.process = { env: {} };
    if (!globalThis.process.env) globalThis.process.env = {};
    for (const [clave, valor] of Object.entries(context.env)) {
      if (typeof valor === "string") globalThis.process.env[clave] = valor;
    }

    const req = context.request;
    const url = new URL(req.url);

    const headers = {};
    for (const [clave, valor] of req.headers) headers[clave.toLowerCase()] = valor;

    const event = {
      httpMethod: req.method,
      path: url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: req.method === "GET" || req.method === "HEAD" ? null : await req.text(),
    };

    const res = await handler(event);
    return new Response(res.body ?? "", {
      status: res.statusCode || 200,
      headers: res.headers || { "Content-Type": "application/json" },
    });
  };
}
