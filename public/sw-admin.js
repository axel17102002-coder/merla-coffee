// Service worker del panel (/admin): solo recibe las notificaciones. No cachea
// nada: el panel siempre trae los datos frescos del servidor.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let aviso = {};
  try { aviso = e.data ? e.data.json() : {}; } catch { aviso = { cuerpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(aviso.titulo || "Merla Coffee", {
    body: aviso.cuerpo || "",
    icon: "/img/icon-admin-512.png?v=1",
    badge: "/img/favicon-admin-64.png?v=1",
    tag: aviso.etiqueta || undefined,
    data: { url: aviso.url || "/admin#inicio" },
  }));
});

// Tocar la notificación abre el panel (o lo trae al frente) en la sección del aviso
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || "/admin#inicio", self.location.origin).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const v of ventanas) {
      if (new URL(v.url).pathname.startsWith("/admin")) {
        await v.focus();
        if (v.navigate) await v.navigate(destino).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
