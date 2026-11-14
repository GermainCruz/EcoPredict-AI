import jwt from 'jsonwebtoken';
import {query} from '../config/db.js';
import {HttpError} from '../utils/errors.js';
export async function authenticate(req,res,next){try{const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new HttpError(401,'Token de acceso requerido');const data=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});if(data.typ!=='access')throw new HttpError(401,'Tipo de token inválido');const {rows}=await query('SELECT u.id,u.full_name,u.email,u.status,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1',[data.sub]);if(!rows.length||rows[0].status!=='active')throw new HttpError(401,'Cuenta inactiva o inexistente');req.user=rows[0];next();}catch(e){next(e.status?e:new HttpError(401,'Sesión inválida o caducada'));}}
export const permit=(...roles)=>(req,res,next)=>roles.includes(req.user?.role)?next():next(new HttpError(403,'Acceso denegado'));
