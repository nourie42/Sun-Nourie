// Accept the preview server's host/port flags without changing production start.
const args=process.argv.slice(2);
const port=args.indexOf('--port');
if(port>=0)process.env.PORT=args[port+1];
await import('../server.js');
