/**
 * Created by za120487 on 2015/03/05.
 */
var gui = require('nw.gui');
var hmi_html = require('gui/hmi_html');
var fs = require('fs');

var win = gui.Window.get();

var _filePathNameObj = { filePath: null},
    urlId;

function recordCreateWindowDisplay(){
    var createTab = 'FileCreationTab',
        createButtonTab = 'FileCreateButtonTab',
        tableId = 'tableId',
        tableDirId = 'tableDirId',
        tableRowDirId = 'tableRowDirId',
        cellDirHeader = 'cellDirHeader',
        HeaderDirId = 'HeaderDirId',
        cellDirId = 'cellDirId',
        FileDirId = 'FileDirId',
        tableRowId = 'tableRowId',
        cellHeader = 'cellHeader',
        HeaderId = 'headerId',
        cellFileNameId = 'cellFileNameId',
        FileNameId = 'FileNameId',
        cellExtensionId = 'cellExtensionId',
        ExtensionId = 'extensionId',
        uploadButtonId = 'uploadButtonId',
        cancelButtonId = 'cancelButtonId',
        createButtonId = 'createButtonId',
        fileCreateId = 'fileCreate',
        fileCreatedTextId = 'fileCreatedTextId';

   // hmi_html_obj.AddTable(tableDirId,createTab,document);
    hmi_html_obj.AddTable(tableId,createTab,document);
   // hmi_html_obj.AddRow(tableRowDirId,tableDirId,document);
    hmi_html_obj.AddRow(tableRowId,tableId,document);
    hmi_html_obj.AddRow(tableRowId,tableId,document);

    /*hmi_html_obj.AddCell(cellDirHeader,tableRowDirId,document);
    hmi_html_obj.AddHeader('p','Choose Directory: ',HeaderDirId,cellDirHeader,document);

    hmi_html_obj.AddCell(cellDirId, tableRowDirId, document);
    hmi_html_obj.AddInputFileUploadButton(FileDirId,'file',cellDirId,document);*/

    hmi_html_obj.AddCell(cellHeader,tableRowId,document);
    hmi_html_obj.AddHeader('p','Enter File Name: ../configuration/configuration_record/',HeaderId,cellHeader,document);

    hmi_html_obj.AddCell(cellFileNameId, tableRowId, document);
    hmi_html_obj.AddTextBox(FileNameId, FileNameId, cellFileNameId, document);

    hmi_html_obj.AddCell(cellExtensionId,tableRowId,document);
    hmi_html_obj.AddHeader('p','.json',ExtensionId,cellExtensionId,document);

    hmi_html_obj.AddButton('create',createButtonId,createButtonTab,document);
    hmi_html_obj.AddButton('create and load',uploadButtonId,createButtonTab,document);
    hmi_html_obj.AddButton('close',cancelButtonId,createButtonTab,document);

    loadButton = document.getElementById(uploadButtonId);

    loadButton.onclick = function(){
        var newFile = document.getElementById(FileNameId).value;
        if(newFile === null) {
            alert("Please enter the recording file name");
        }
        else{
            fs.writeFile('./configuration/configuration_record/'+newFile+'.json','{}',function(err){
                if(err){
                    throw(err);
                }
                else{
                    $('#' + fileCreateId).empty();
                    hmi_html_obj.AddHeader('h5','./configuration/configuration_record/'+newFile+'.json '+'created',fileCreatedTextId,fileCreateId,document);

                    var  inRecordFilePathArray = false;
                    for(var i=0;i<global.NewRecordPathArr.length;i++){
                        if(global.NewRecordPathArr[i].id === urlId){
                            global.NewRecordPathArr[i].fileName = './configuration/configuration_record/'+newFile+'.json';
                            inRecordFilePathArray = true;
                        }
                    }
                    if(inRecordFilePathArray === false){
                        global.NewRecordPathArr.push({id:urlId, fileName: './configuration/configuration_record/'+newFile+'.json'});
                    }
                    global.NewRecordFileSaveStatus = global.NewRecordButtonEnum.NEW;

                    win.close();
                }
            });
        }
    };

    createButton = document.getElementById(createButtonId);

    createButton.onclick = function(){
        var newFile = document.getElementById(FileNameId).value;
        if(newFile === null) {
            alert("Please enter the recording file name");
        }
        else{
            fs.writeFile('./configuration/configuration_record/'+newFile+'.json','{}',function(err){
                if(err){
                    throw(err);
                }
                else{
                    $('#' + fileCreateId).empty();
                    hmi_html_obj.AddHeader('h5','./configuration/configuration_record/'+newFile+'.json '+'created',fileCreatedTextId,fileCreateId,document);
                }
            });
        }
    };

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

        hmi_html_obj = new hmi_html();
        recordCreateWindowDisplay();
    }
    catch(e){
        console.log(e);
    }
};