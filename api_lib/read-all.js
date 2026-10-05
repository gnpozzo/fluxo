export async function readAll(makeQuery) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
  throw Object.assign(new Error('La consulta es demasiado amplia; reducí el período.'), { status: 413 });
}

export async function readInBatches(values, makeQuery) {
  const result=[];
  const unique=[...new Set(values)];
  for(let offset=0;offset<unique.length;offset+=100) {
    const batch=unique.slice(offset,offset+100);
    result.push(...await readAll(()=>makeQuery(batch)));
  }
  return result;
}
