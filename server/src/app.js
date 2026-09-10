import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/health.routes.js';
import hyxiRoutes from './routes/hyxi.routes.js';
import plantsRoutes from './routes/plants.routes.js';
import devicesRoutes from './routes/devices.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import authRoutes from './routes/auth.routes.js';
import growattRoutes from './routes/growatt.routes.js';
import { requireAuth } from './middleware/auth.middleware.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/integrations', requireAuth);
app.use('/api/integrations/hyxi', hyxiRoutes);
app.use('/api/integrations/growatt', growattRoutes);
app.use('/api/plants', requireAuth, plantsRoutes);
app.use('/api/devices', requireAuth, devicesRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);

export default app;
