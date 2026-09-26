import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/health.routes.js';
import hyxiRoutes from './routes/hyxi.routes.js';
import plantsRoutes from './routes/plants.routes.js';
import devicesRoutes from './routes/devices.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import authRoutes from './routes/auth.routes.js';
import growattRoutes from './routes/growatt.routes.js';
import usersRoutes from './routes/users.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import maintenanceRoutes from './routes/maintenance.routes.js';
import { requireAuth } from './middleware/auth.middleware.js';
import { loadProfile } from './middleware/authorization.middleware.js';
import { apiLimiter, sensitiveLimiter } from './middleware/rateLimit.middleware.js';
import { corsOptions } from './config/cors.js';

const app = express();

// Render corre detrás de un único proxy: necesario para que
// req.ip (y el rate limiting) vea la IP real del cliente.
app.set('trust proxy', 1);

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api/health', healthRoutes);
app.use('/api/', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/plants', requireAuth, loadProfile, plantsRoutes);
app.use('/api/devices', requireAuth, loadProfile, devicesRoutes);
app.use('/api/dashboard', requireAuth, loadProfile, dashboardRoutes);
app.use('/api/integrations', sensitiveLimiter, requireAuth, loadProfile);
app.use('/api/integrations/hyxi', hyxiRoutes);
app.use('/api/integrations/growatt', growattRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/maintenance', requireAuth, loadProfile, maintenanceRoutes);

export default app;
