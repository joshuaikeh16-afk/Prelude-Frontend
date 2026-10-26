import { $, icon, esc, mount, navigation, empty, errorMessage, toast } from './ui.js';
import { getUser, profileData, updateProfile, synchronize } from './data.js';
import { timerBar } from './timer.js';
const page=document.body.dataset.page;
export const root=$('#app');
export const brand=`<span class="mark">${icon('spark')}</span><span>PRELUDE</span>`;
export function header(){return `<header class="topbar"><a class="wordmark" href="index.html" aria-label="Prelude home">${brand}</a><a class="avatar" href="profile.html" aria-label="Profile">${icon('user')}</a></header>`}
function introSeen(){try{return localStorage.getItem('prelude-intro-v1')==='done'}catch{return true}}
async function start(){
 if(page!=='intro'&&!introSeen()){location.replace('intro.html');return}
 if(['intro','signin','signup','reset'].includes(page)){const auth=await import('./screens/auth-flow.js');await auth.renderAuth(page,root);return}
 const user=await getUser();if(!user){location.replace('signin.html');return}
 const profile=profileData(user);
 if(!profile.profileComplete&&!(profile.name&&profile.nickname)){location.replace('signup.html');return}
 if(!profile.walkthroughComplete&&page!=='home'){location.replace('index.html');return}
 document.querySelector('.app-shell').insertAdjacentHTML('afterbegin',header());
 document.body.insertAdjacentHTML('beforeend',navigation(`${page==='home'?'index':page==='workspace'?'events':page}.html`));
 await synchronize();
 if(page==='create'){await(await import('./screens/create-flow.js')).renderCreate(root,user)}
 else if(page==='workspace'){await(await import('./screens/workspace.js')).renderWorkspace(root,user)}
 else {await(await import('./screens/pages.js')).renderPage(page,root,user)}
 await timerBar(user);
 if(page==='home'&&!profile.walkthroughComplete)walkthrough(user);
 supabaseClient.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')location.replace('signin.html')});
}
function walkthrough(user){
 const steps=[['Your next meaningful moment','Home brings your nearest event into focus. Your countdown and preparation progress come from your event.'],['Give your plans a home','Events holds everything you’re preparing for. Switch to Past to revisit the moments you’ve lived.'],['Make room for what matters','Create an event with a name and date. Add goals, tasks and notes at your own pace.'],['See the days ahead','Tap a calendar day to see its events. Long-press to create an event on that date.']];
 let step=0;const dialog=document.createElement('dialog');dialog.className='modal tour-modal';document.body.append(dialog);dialog.addEventListener('cancel',e=>e.preventDefault());
 function render(){dialog.innerHTML=`<span class="eyebrow">YOUR PRELUDE · ${step+1} OF ${steps.length}</span><h2>${steps[step][0]}</h2><p>${steps[step][1]}</p><div class="stepper">${steps.map((_,i)=>`<span class="${i<=step?'done':''}"></span>`).join('')}</div><button class="btn primary full">${step===3?'Start preparing':'Next'}${icon('arrow')}</button>`;$('button',dialog).onclick=async()=>{if(step<3){step++;render();return}const button=$('button',dialog);button.disabled=true;try{await updateProfile(user,{walkthroughComplete:true});dialog.close();dialog.remove()}catch(e){button.disabled=false;toast(errorMessage(e))}}}
 render();dialog.showModal();
}
start().catch(error=>mount(root,empty('A moment, please',errorMessage(error),'','')+'<button class="btn full" id="retryPage">Try again</button>'));
document.addEventListener('click',e=>{if(e.target.closest('#retryPage'))location.reload()});
window.addEventListener('offline',()=>toast('You’re offline. Changes need a connection to save.'));
