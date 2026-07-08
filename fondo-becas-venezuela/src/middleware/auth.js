const basicAuth = require('express-basic-auth');

// Protege /admin con usuario/clave definidos en variables de entorno.
// Cambia ADMIN_USER / ADMIN_PASSWORD antes de desplegar a producción.
const adminAuth = basicAuth({
  users: {
    [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASSWORD || 'changeme'
  },
  challenge: true,
  realm: 'Panel admin - Fondo de Becas 4Geeks Venezuela'
});

module.exports = { adminAuth };
