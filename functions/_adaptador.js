// Adaptador Cloudflare Pages ⇄ funciones estilo Netlify.
// Permite usar EXACTAMENTE el mismo backend (netlify/functions/*) en las dos
// plataformas: convierte el Request de Cloudflare al `event` que esperan los
// handlers y su respuesta {statusCode, headers, body} a un Response.

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
