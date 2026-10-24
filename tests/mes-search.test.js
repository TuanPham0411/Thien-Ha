import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterIssues,issueFilterOptions} from '../mes/site/model.js';
const closed={id:'closed-id',ticketNumber:'TH2610-01',subject:'Máy in bị kẹt',description:'Không in được tem tại trạm 3',assessment:'Đã thay cảm biến',reporterName:'Nguyễn Đặng',reporterUsername:'nguyen.dang',reporterUid:'private-user-id',issueTypeId:'quality-old',issueTypeName:'Chất lượng',departmentId:'assembly-old',departmentName:'Lắp ráp',status:'Closed',priority:'High'};
const open={id:'open-id',ticketNumber:'TH2610-02',subject:'Network failure',description:'Scanner is offline',reporterName:'Alex',issueTypeId:'network',issueTypeName:'Network',departmentId:'testing',departmentName:'Testing',status:'New',priority:'Medium'};
const records=[closed,open];
test('closed tickets remain searchable by number, title, reporter, type, department, description and assessment',()=>{
 for(const [searchField,search] of [['ticket','th2610-01'],['user','DANG NGUYEN'],['user','NGUYEN.DANG'],['title','may in'],['type','chat luong'],['department','lap rap'],['content','khong in duoc'],['content','cam bien']])assert.deepEqual(filterIssues(records,{searchField,search}),[closed],searchField);
 assert.deepEqual(filterIssues(records,{status:'Closed'}),[closed]);assert.deepEqual(filterIssues(records),records);
});
test('field selection isolates searches and combines with all filters without hiding closed records',()=>{
 assert.deepEqual(filterIssues(records,{searchField:'title',search:'nguyen'}),[]);
 assert.deepEqual(filterIssues(records,{search:'nguyen chat luong',status:'Closed',department:'assembly-old',issueType:'quality-old',priority:'High'}),[closed]);
 assert.deepEqual(filterIssues(records,{search:'nguyen',issueType:'network'}),[]);
 assert.deepEqual(filterIssues(records,{searchField:'user',search:'private-user-id'}),[]);
 assert.deepEqual(filterIssues(records,{search:'   \n '}),records);
});
test('filter choices retain historical departments and issue types, and support unclassified tickets',()=>{
 const choices=issueFilterOptions(records,[{id:'testing',name:'New testing name'},{id:'unused',name:'Unused'}]);
 assert.equal(choices.departments.find(x=>x.id==='assembly-old').name,'Lắp ráp');assert.equal(choices.departments.find(x=>x.id==='testing').name,'New testing name');assert.equal(choices.departments.filter(x=>x.id==='testing').length,1);assert.ok(choices.types.some(x=>x.id==='quality-old'));
 assert.equal(filterIssues([{...closed,issueTypeId:null,issueTypeName:null}],{issueType:'__unclassified',searchField:'type',search:'chua phan loai'}).length,1);
});
