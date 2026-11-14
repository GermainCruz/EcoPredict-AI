import 'dotenv/config';import crypto from 'node:crypto';import {app} from './app.js';import {pool} from './config/db.js';
if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32||process.env.JWT_SECRET.startsWith('REEMPLAZAR'))throw new Error('Configura JWT_SECRET aleatorio (32+ caracteres)');
await pool.query('SELECT 1');const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`EcoPredict API http://localhost:${port}`));
