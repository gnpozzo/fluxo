import { enhanceView } from './Presentation.js';
export function lazyModule(id, loader, exportName) {
  let instance, pending;
  const load=async()=>{
    if(!pending) pending=loader().then(exports=>{
      instance=new exports[exportName]();
      const build=instance._buildVista.bind(instance);
      instance._buildVista=(...args)=>{const result=build(...args);enhanceView(document.getElementById(instance.vistaId),id);return result;};
      instance.init();
      return instance;
    }).catch(error=>{pending=null;throw error;});
    return pending;
  };
  return new Proxy({}, { get(_target,property) {
    if(property==='moduleId') return id;
    if(property==='init') return ()=>{};
    if(property==='destruir') return ()=>instance?.destruir();
    if(property==='load') return load;
    if(property==='then') return undefined;
    return (...args)=>load().then(module=>module[property](...args)).catch(error=>{
      console.error('[Module]',id,error.message);
      window.App.Toast?.error('No se pudo abrir el módulo. Volvé a intentarlo.');
      return false;
    });
  }});
}
