import { runScan } from './scanner.js';
import { config } from './config.js';

try{
  const result=await runScan({maxItems:config.scanMaxItemsPerSource});
  console.log(JSON.stringify(result,null,2));
}catch(error){
  console.error(`Property scan failed: ${error.message}`);
  process.exitCode=1;
}
