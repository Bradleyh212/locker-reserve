const {test}=require('node:test');
const assert=require('node:assert/strict');
test('only the optional Next registry query gets a bounded timeout', async()=>{
  const saved=global.fetch;
  const registry='https://registry.npmjs.org/-/package/next/dist-tags';
  const seen=[];
  global.fetch=(url,options)=>{
    seen.push([url,options]);
    if(url!==registry) return Promise.resolve('untouched');
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  };
  let watchdog;
  try {
    require('./dev-fetch-timeout.cjs');
    const options={method:'POST',body:'test'};
    assert.equal(await fetch('http://localhost:3001/example',options),'untouched');
    assert.equal(seen[0][1],options);
    await assert.rejects(Promise.race([
      fetch(registry),
      new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('deadline not enforced')),4500);}),
    ]),error=>error.name==='TimeoutError');
  } finally {clearTimeout(watchdog);global.fetch=saved;}
});
