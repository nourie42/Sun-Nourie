import {isIP} from 'node:net';

// Render's Cloudflare edge overwrites this header with the actual client IP.
// X-Forwarded-For can contain a caller-supplied leftmost address.
export function clientIp(req,env=process.env){
 const forwarded=env.RENDER==='true'?String(req.headers['cf-connecting-ip']||'').trim():'';
 return isIP(forwarded)?forwarded:req.ip||req.socket?.remoteAddress||'unknown';
}
