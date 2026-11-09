// The left button rail: Sound mixer, My snacks and Meme sounds live in ONE column (under the back arrow while a movie plays),
// so they are always the same size, evenly spaced and never overlap. Order in the column is set with CSS `order` in style.css.
export const rail=document.getElementById('rail')||Object.assign(document.createElement('div'),{id:'rail'});
if(!rail.isConnected)document.body.appendChild(rail);
