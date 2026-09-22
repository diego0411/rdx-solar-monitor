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
import { requireAuth } from './middleware/auth.middleware.js';
import { loadProfile } from './middleware/authorization.middleware.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/plants', requireAuth, loadProfile, plantsRoutes);
app.use('/api/devices', requireAuth, loadProfile, devicesRoutes);
app.use('/api/dashboard', requireAuth, loadProfile, dashboardRoutes);
app.use('/api/integrations', requireAuth, loadProfile);
app.use('/api/integrations/hyxi', hyxiRoutes);
app.use('/api/integrations/growatt', growattRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);

export default app;
