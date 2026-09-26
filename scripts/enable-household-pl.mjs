// Run from the checked-out Sun-Nourie repository, after reviewing the deployment settings.
// Only adds the private route import/registration; no public navigation is changed.
import fs from 'node:fs/promises';
const file=new URL('../server.js',import.meta.url);
const original=await fs.readFile(file,'utf8');
const importLine="import {registerHouseholdPLRoutes} from './src/householdPL.js';";
const registration='registerHouseholdPLRoutes(app);';
if(original.includes('registerHouseholdPLRoutes')){
 if(original.includes(registration)&&original.includes('./src/householdPL.js'))console.log('Private route is already registered.');
 else throw Error('Partial integration found; reconcile manually without duplicating it.');
}else{
 const marker='const app = express();';
 if(original.split(marker).length!==2)throw Error('Unexpected server layout. No file was changed.');
 const updated=importLine+'\n'+original.replace(marker,marker+'\n'+registration);
 await fs.writeFile(file,updated);console.log('Added private route import and registration only.');
}
