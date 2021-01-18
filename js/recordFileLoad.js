/**
 * Created by za120487 on 2015/03/05.
 */
var gui = require('nw.gui');
var graphics = require('graphics.js');

var win = gui.Window.get();

var _filePathNameObj = { filePath: null },
    urlId;

function recordConfigWindowDisplay(){
    var loadTab = 'LoadTab',
        loadButtonTab = 'LoadButtonTab',
        uploadFileId = 'uploadFileId',
        uploadButtonId = 'uploadButtonId',
        cancelButtonId = 'cancelButtonId';

    _graphicsObj.AddInputFileUploadButton(uploadFileId, ".json", loadTab, document);

    uploadFile = document.getElementById(uploadFileId);

    uploadFile.onchange = function(){
        _filePathNameObj.filePath = uploadFile.value;
    };

    _graphicsObj.AddButton('load',uploadButtonId,loadButtonTab,document);

    loadButton = document.getElementById(uploadButtonId);

    loadButton.onclick = function(){
       if(_filePathNameObj.filePath === null) {
           alert("Please choose a recording file before selecting load");
       }
        else{
           var  inRecordFilePathArray = false;
           for(var i=0;i<global.NewRecordPathArr.length;i++){
               if(global.NewRecordPathArr[i].id === urlId){
                   global.NewRecordPathArr[i].fileName = '../configuration/configuration_record/'+newFile+'.json';
                   inRecordFilePathArray = true;
               }
           }
           if(inRecordFilePathArray === false){
               global.NewRecordPathArr.push({id:urlId, fileName: '../configuration/configuration_record/'+newFile+'.json'});
           }
           global.NewRecordFileSaveStatus = global.NewRecordButtonEnum.NEW;
           win.close();
       }
    };

    _graphicsObj.AddButton('cancel',cancelButtonId,loadButtonTab,document);

    cancelButton = document.getElementById(cancelButtonId);

    cancelButton.onclick = function(){
        win.close();
    };
}

onload = function(){
    try{
        urlSearch = document.location.search;
        urlId = urlSearch.substr(urlSearch.indexOf('?') + 1, urlSearch.length);
        urlId = +urlId;

        _graphicsObj = new graphics();
        recordConfigWindowDisplay();
    }
    catch(e){
        console.log(e);
    }
};