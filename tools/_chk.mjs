const f = process.argv[2];
const m = await import(f);
const g = m.build();
let tris = 0, meshes = 0; g.traverse(o => { if (o.isMesh) { meshes++; const q = o.geometry; tris += (q.index ? q.index.count : q.attributes.position.count) / 3; } });
const THREE = await import('three'); g.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(g);
console.log(m.info.id, m.info.name, 'tris', Math.round(tris), 'meshes', meshes, 'box y', b.min.y.toFixed(2), b.max.y.toFixed(2), 'x', b.min.x.toFixed(2), b.max.x.toFixed(2), 'z', b.min.z.toFixed(2), b.max.z.toFixed(2), 'tick', !!g.userData.tick);
