export function compactDashboard(){
 const page=document.getElementById('dashboard-page'),timeline=document.getElementById('incident-timeline'),board=page.querySelector('.workspace-board');
 page.querySelector('#metrics').after(timeline);
 const overview=document.createElement('section');overview.className='dashboard-overview';overview.setAttribute('aria-label','Operations overview');
 for(const id of ['status-chart','resolution-insights','recent-issues'])overview.append(document.getElementById(id).closest('article'));
 timeline.after(overview);overview.after(board);
 const details=document.createElement('details');details.className='dashboard-extra';details.id='dashboard-extra';const summary=document.createElement('summary');summary.textContent='Additional analysis';details.append(summary);
 const classification=document.createElement('div');classification.className='chart-grid dashboard-classification-row';
 for(const id of ['priority-chart','issue-type-chart','department-progress'])classification.append(document.getElementById(id).closest('article'));
 for(const grid of [...page.querySelectorAll(':scope > .chart-grid,:scope > #detailed-analytics')]){if(grid.classList.contains('operations-grid'))details.append(classification);if(grid.id==='detailed-analytics'||grid.children.length)details.append(grid);else grid.remove();}
 page.append(details);
}
