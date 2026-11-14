import pg from 'pg';
import 'dotenv/config';
if(!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en backend/.env');
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000});
export const query=(sql,params=[])=>pool.query(sql,params);
export async function tx(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
