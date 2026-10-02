export function withTimeout(promise,ms,label='Message loading timed out. Retry or open Original message.'){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(label),{code:'TIMEOUT'})),ms);})]).finally(()=>clearTimeout(timer));
}
