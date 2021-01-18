var gui = require('nw.gui'),
    childProcess = require('child_process'),
    jf = require('jsonfile'),
    fs = require('fs'),
    Primus = require('primus.io'),
    ws = require('ws'),
    fileParser = require('parser/configuration_file_parser'),
    hmi_bootstrap = require('gui/hmi_bootstrap'),
    error_manager = require('manager/Manager_error'),
    field_modifier = require('message_modifier/message_field_modifier'),
    random_generator = require('random_generator/random_generator'),
    deepcopy = require('deepcopy'),
    type_conversion = require('types/TypeConversion.js'),
    record_config = require('recorder/recorder_configuration');
//  record = require('recorder/recorder_main');

var win = gui.Window.get(),
    error_list = error_manager.error,
    _comms_arr = null, // fileParser.ifList,
    headerData = null, // fileParser.headerList,
    _script_list = null, // fileParser.scriptList,
    converter = field_modifier.converter_main_cls,
    counter = field_modifier.counter_main_cls,
    urlId,
    urlSearch,
    isMain = global.MainEnum.INSTANCE,
    interface_file_name,
    _comms_obj = [],
    _comms_socket_obj = [],
    _hmi_serialize_collection = [],
    gridster,
    hmi_file_path = null,
    hmi_configuration = null,
    element_id_length = 3,
    script_id_length = 5,
    hmi_element_gridster_arr = [],
    hmi_selected_containers_arr = [],
    hmi_element_list = {},
    messages_in_transmission = {},
    respond_reply_arr = [],
    isOn_GridCreator = false,
    isOn_ToolBox = false,
    rx_message_obj = {},
    _script_process_obj = {},
    rx_event_listeners_obj = {},
    data_viewer_obj = {},
    internal_field_manipulators_list = {},
    _comms_status_obj = {};

var comms_universal_button = '#univeral_interface_connect_button',
    SaveAsHmi_modal = 'hmi_save_as_modal',
    close_instance_modal = 'close_instance_modal',
    hmi_toolbox_div = 'hmi_toolbox_div',
    close_application_modal_button_id = '#close_application_modal_button';

function socket_obj(port, in_use){
    this.port = port;
    this.in_use = in_use;
}

function hmi_element_obj(id, element_type, offset, dimensions, parent, _element_properties_obj){
    this.id = id;
    this.element_type = element_type;
    this.offset = offset;
    this.dimension = dimensions;
    this.parent = parent;
    this._element_properties_obj = _element_properties_obj;
}

function transmit_packet(protocol, id, interface_name, byteLength, _message_arr, counter, type){
    this.protocol = protocol;
    this.id = id;
    this.interface_name = interface_name;
    this.byteLength = byteLength;
    this._message_arr = _message_arr;
    this.counter = counter;
    this.type = type;
}

function AutomaticScriptsLauncher(){
    /*todo update with tx obj and rx obj when received*/
    try {
        for (var current_script in _script_list.script) {
            if (_script_list.script[current_script].attributes.automated === true) {
                console.log('creating script');
                _script_process_obj[_script_list.script[current_script].attributes.id] = childProcess
                    .spawn(
                    'node',
                    ['./node_modules/script-manager/script-manager.js'],
                    {
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                    });

                _script_process_obj[_script_list.script[current_script].attributes.id].stdout.on('data', function (data) {
                    try {
                       //console.log(data.toString());
                        _hmi.console(data.toString(),document);
                    }catch(e){
                        console.log(e);
                    }
                });

                _script_process_obj[_script_list.script[current_script].attributes.id].stderr.on('data', function(data){
                    try {
                        var error = JSON.parse(data);
                        if (error.id === error_list.SCRIPT_FILE_NOT_FOUND) {
                            // _error_manager.ErrorAlert(error.error, error.file, document);
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error.error].type,
                                error_list.properties[error.error].name,
                                error_list.properties[error.error].message,
                                error_list.properties[error.error].hint,
                                error.file,
                                document);
                            ScriptProcessClose(_script_list.script[current_script].attributes.id);
                        }
                        else if(error.id === error_list.SCRIPT_TRANSMIT_OBJECT_INVALID){
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error.error].type,
                                error_list.properties[error.error].name,
                                error_list.properties[error.error].message,
                                error_list.properties[error.error].hint,
                                '',
                                document
                            );
                        }
                    }catch (e){

                    }
                });

                _script_process_obj[_script_list.script[current_script].attributes.id]
                    .on('message', function (data) {
                        var dataObj = JSON.parse(data);
                        if(dataObj.id === global.ScriptTypeList.TRANSMIT_OBJECT.name){
                            console.log('sending data from script', dataObj);
                            global.socket_master[urlId][dataObj.tx_interface_name].
                                primus.write(
                                new transmit_packet(
                                    global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX,
                                    _random_generator.randomString(script_id_length),
                                    dataObj.tx_interface_name,
                                    dataObj.tx_byte_length,
                                    dataObj.tx_message_arr,
                                    1,
                                    1
                                )
                            );
                        }
                });

                _script_process_obj[_script_list.script[current_script].attributes.id]
                    .send(JSON.stringify(
                        {
                            id: global.ScriptTypeList.SCRIPT_OBJECT.name,
                            object: _script_list.script[current_script],
                            comms_arr: _comms_arr,
                            comms_status: _comms_status_obj
                        }));

            }
         //   _hmi.console('SCRIPT PROCESS', current_script+' started successfully', document);
        }
    }
    catch(e){
        console.log('script error',e);
    }
}

function ScriptProcessClose(script_id){
    if(_script_process_obj[script_id] !== undefined) {
        _script_process_obj[script_id].kill('SIGKILL');
        _script_process_obj[script_id] = undefined;
    }
}

function ScriptCommsStatusUpdate(interface_name, status) {
    _comms_status_obj[interface_name].status = status;
    for (var scripts in _script_process_obj) {
        _script_process_obj[scripts]
            .send(JSON.stringify(
                {
                    id: global.ScriptTypeList.INTERFACE_STATUS.name,
                    interface_name: interface_name,
                    status: status
                }));
    }
}

function ReceivedDataToScript(rx_data_object) {
    console.log('script shit',rx_data_object);
    for (var scripts in _script_process_obj) {
        _script_process_obj[scripts]
            .send(JSON.stringify(
                {
                    id: global.ScriptTypeList.RX_UPDATE.name,
                    object: rx_data_object
                }));
    }
}

function LinkerSocketClient(socket_obj, interface_name) {
    console.log('DEBUG_1', 'linker socket client', interface_name);
    var Socket = Primus.createSocket({
        transformer: 'websockets',
        parser: 'JSON',
        timeout: false
    });

    socket_obj.primus = new Socket("ws://localhost:" + socket_obj.port_number);
    socket_obj.comms_linker_parameters_obj = {};
    switch (_comms_obj[interface_name].type) {
        case global.Communication_Interface_Type_Enum.UDP.name:
            socket_obj.comms_linker_parameters_obj = {
                protocol: global.Communication_Linker_Emitter_Obj.LINKER_INITIALISE,
                interfaceType: global.Communication_Interface_Type[_comms_obj[interface_name].type].value,
                interfaceName: interface_name,
                _interfaceObj: _comms_obj[interface_name],
                schedulerCycle_period: _comms_obj[interface_name].cyclePeriod,
                comms_interface_type: _comms_obj[interface_name].type,
                srcip: jQuery('#' + interface_name + '_src_ip').val(),
                dstip: jQuery('#' + interface_name + '_dst_ip').val(),
                srcport: +jQuery('#' + interface_name + '_src_port').val(),
                dstport: +jQuery('#' + interface_name + '_dst_port').val()
            };

            console.log('DEBUG LINKER', _comms_obj[interface_name]);
            break;
    }

    socket_obj.primus.on('open', function (data) {

        console.log('DEBUG_1', 'sending initilisation data', interface_name, socket_obj);
        socket_obj.primus.write(socket_obj.comms_linker_parameters_obj);

        socket_obj.primus.on('data', function (object) {
            if (object.protocol === global.Communication_Linker_Emitter_Obj.LINKER_OPEN) {

                $('#' + interface_name + '_connect_status').text(global.GUI_Text_Enum.COMMS_LABEL_CONNECTED)
                    .removeClass()
                    .addClass('label label-success');
                $('#' + interface_name + '_connect_button').text(global.GUI_Text_Enum.COMMS_BUTTON_DISCONNECT)
                    .attr('comms_connected', true);

                var all_comms_interfaces_connected = true;
                var comms_connected_element_list = jQuery('[comms_connected]');
                $.each(comms_connected_element_list, function (i, l) {
                    var comms_connected_value = comms_connected_element_list[i].attributes['comms_connected'].value;
                    var isCommsConnected = (comms_connected_value == 'true');
                    if (isCommsConnected === false) {
                        all_comms_interfaces_connected = false;
                    }
                });
                if (all_comms_interfaces_connected === true) {
                    $(document).ready(function () {
                        $(comms_universal_button)
                            .removeClass('icon-link')
                            .addClass('icon-unlink')
                            .attr('all_comms_connected', true)
                            .attr('title', global.GUI_Text_Enum.COMMS_ALL_ANCHOR_DISCONNECT)
                            .tooltip('fixTitle')
                            .data('bs.tooltip')
                            .$tip.find('.tooltip-inner')
                            .text(global.GUI_Text_Enum.COMMS_ALL_ANCHOR_DISCONNECT);
                    });
                }
                ScriptCommsStatusUpdate(interface_name, global.CommsStatusEnum.OPEN);
            }
            else if (object.protocol === global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX_FINITE) {
                messages_in_transmission[object.id].counter = object.counter;

                for (manipulation in global.DataManipulationTypes) {
                    console.log('DEBUG', 'Manipulation type', global.DataManipulationTypes[manipulation], manipulation);
                    if (global.DataManipulationTypes[manipulation].name !== global.DataManipulationTypes.CONVERSION.name) {
                        InternalFieldValueManipulation(messages_in_transmission[object.id].id,
                            messages_in_transmission[object.id].interface_name,
                            messages_in_transmission[object.id].id,
                            messages_in_transmission[object.id]._message_arr,
                            global.DataManipulationTypes[manipulation].name);
                    }
                }
                InternalFieldValueManipulation(messages_in_transmission[object.id].id,
                    messages_in_transmission[object.id].interface_name,
                    messages_in_transmission[object.id].id,
                    messages_in_transmission[object.id]._message_arr,
                    global.DataManipulationTypes.CONVERSION.name);

                global.socket_master[urlId][object.interface_name]
                    .primus.write(messages_in_transmission[object.id]);

                if (object.counter === 0) {
                    $('#' + object.id).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
                }
            }
            else if (object.protocol === global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX_INFINITE) {
                for (manipulation in global.DataManipulationTypes) {
                    console.log('DEBUG', 'Manipulation type', global.DataManipulationTypes[manipulation], manipulation);
                    if (global.DataManipulationTypes[manipulation].name !== global.DataManipulationTypes.CONVERSION.name) {
                        InternalFieldValueManipulation(messages_in_transmission[object.id].id,
                            messages_in_transmission[object.id].interface_name,
                            messages_in_transmission[object.id].id,
                            messages_in_transmission[object.id]._message_arr,
                            global.DataManipulationTypes[manipulation].name);
                    }
                }
                InternalFieldValueManipulation(messages_in_transmission[object.id].id,
                    messages_in_transmission[object.id].interface_name,
                    messages_in_transmission[object.id].id,
                    messages_in_transmission[object.id]._message_arr,
                    global.DataManipulationTypes.CONVERSION.name);

                global.socket_master[urlId][object.interface_name]
                    .primus.write(messages_in_transmission[object.id]);
            }
            else if (object.protocol === global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX_RESPOND_UNTIL) {
                console.log('respond until', object);
                console.log('respond until tx', messages_in_transmission[object.id]);
                global.socket_master[urlId][object.interface_name]
                    .primus.write(messages_in_transmission[object.id]);
            }
            else if (object.protocol === global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_RX) {
                /*The rx object consist of:
                 *interface_name : the interface name,
                 *length: the amount of message fields
                 *msgObj: The message field array.
                 * *each array consists of:
                 * **count: the amount (used the the string size)
                 * **field_number: the number slot of the field in the message
                 * **key: the value type
                 * **name: the field name
                 * **type_length: the value type length
                 * **value: the data value
                 *
                 *rx_message_name: the recieved message name
                 *timestamp: the array of length 2 containing the timestamp
                 *  */
                rx_message_obj[object.interface_name][object.rx_message_name] = object;

                /*sending raw rx data object to script*/
                ReceivedDataToScript(object);

                ReceiveMessageResponse(object.rx_message_name, object.interface_name);

                InternalFieldValueManipulation(
                    global.communicationDirectionType.RECEIVE.value,
                    object.interface_name,
                    object.rx_message_name,
                    object.msgObj,
                    global.DataManipulationTypes.CONVERSION.name);

                DataViewerExecute(object);

                /* if(_script_process_obj !== undefined) {
                 for (script in _script_process_obj) {
                 _script_process_obj[script]
                 .send(JSON.stringify({
                 id: global.ScriptTypeList.RX_UPDATE.name,
                 object: object
                 }));
                 }
                 }*/
                console.log('DEBUG_1', object, rx_event_listeners_obj);
            }
            else if (object.protocol === global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_REMOVED) {
                delete messages_in_transmission[object.id];
            }
            else if(object.protocol === global.Communication_Linker_Emitter_Obj.LINKER_ERROR) {
                console.log('DEBUG message buffer type overflow',object);
                _hmi.ErrorAlertCreator(
                    error_list.properties[object.error.name].type,
                    error_list.properties[object.error.name].name,
                    error_list.properties[object.error.name].message,
                    object.error.message,
                    error_list.properties[object.error.name].hint,
                    document);
            }
        });
    });
}

function InternalFieldValueManipulation(name, interface_name, message_name, message_object, data_manipulation_type){
    if(internal_field_manipulators_list[name][interface_name][data_manipulation_type] !== undefined) {
        var field_manipulation_size = internal_field_manipulators_list[name][interface_name][data_manipulation_type][message_name].length;
        if (field_manipulation_size !== undefined) {
            for (var i = 0; i < field_manipulation_size; i++) {
                var current_manipulation = internal_field_manipulators_list[name][interface_name][data_manipulation_type][message_name][i];
                switch (data_manipulation_type) {
                    case global.DataManipulationTypes.CONVERSION.name:
                        try {
                          //  console.log('DEBUG', "CONVERSION PARAMETERS", message_object[current_manipulation.message_field_number], current_manipulation.attributes);
                            message_object[current_manipulation.message_field_number].value = _converter_msg_field_Obj
                                .Converter(
                                message_object[current_manipulation.message_field_number],
                                current_manipulation.attributes);
                        }
                        catch (e) {
                            console.log(e);
                            var error = error_list.VALUE_MANIPULATION_CONVERSION_ERROR;
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error].type,
                                error_list.properties[error].name,
                                error_list.properties[error].message,
                                e.code,
                                e.message,
                                document);
                        }
                        break;

                    case global.DataManipulationTypes.COPY.name:
                        try {
                            if(rx_message_obj[current_manipulation.attributes.interface_name][current_manipulation.attributes.message_name] !== null) {
                                var temp_value =
                                    rx_message_obj[current_manipulation.attributes.interface_name][current_manipulation.attributes.message_name]
                                        .msgObj[current_manipulation.attributes.message_field_number].value;

                                if (temp_value !== undefined) {

                                    switch (message_object[current_manipulation.message_field_number].key) {
                                        case 'UINT8':
                                            message_object[current_manipulation.message_field_number].value = _type_conversion.toUINT8(temp_value);
                                            break;

                                        case 'INT8':
                                            message_object[current_manipulation.message_field_number].value = _type_conversion.toINT8(temp_value);
                                            break;

                                        case 'UINT16':
                                            message_object[current_manipulation.message_field_number].value = _type_conversion.toUINT16(temp_value);
                                            break;

                                        case 'INT16':
                                            message_object[current_manipulation.message_field_number].value = _type_conversion.toINT16(temp_value);
                                            break;

                                        case 'UINT32':
                                            message_object[current_manipulation.message_field_number].value = _type_conversion.toUINT32(temp_value);
                                            break;

                                        case 'INT32':
                                            message_object[current_manipulation.message_field_number].value = _type_conversion.toINT32(temp_value);
                                            break;

                                        case 'FLOAT':
                                            message_object[current_manipulation.message_field_number].value = parseFloat(temp_value);
                                            break;

                                        case 'DOUBLE':
                                            message_object[current_manipulation.message_field_number].value = parseFloat(temp_value);
                                            break;
                                    }
                                }
                            }
                        }
                        catch (e) {
                            var error = error_list.VALUE_MANIPULATION_COPY_ERROR;
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error].type,
                                error_list.properties[error].name,
                                error_list.properties[error].message,
                                e.code,
                                e.message,
                                document);
                        }
                        break;

                    case global.DataManipulationTypes.COUNTER.name:
                        try {
                            message_object[current_manipulation.message_field_number].value = _counter_msg_field_Obj
                                .CounterAdjustment(
                                message_object[current_manipulation.message_field_number],
                                current_manipulation.attributes);
                        }
                        catch (e) {
                            var error = error_list.VALUE_MANIPULATION_COUNTER_ERROR;
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error].type,
                                error_list.properties[error].name,
                                error_list.properties[error].message,
                                e.code,
                                e.message,
                                document);
                        }
                        break;
                }

            }
        }
    }
}

function DataViewerExecute(rx_object){
    try {
        if (rx_event_listeners_obj[rx_object.interface_name] !== undefined) {
            if (rx_event_listeners_obj[rx_object.interface_name][rx_object.rx_message_name] !== undefined) {
                var elements_size = rx_event_listeners_obj[rx_object.interface_name][rx_object.rx_message_name].length;
                for(var i=0; i<elements_size; i++){
                    var current_event = rx_event_listeners_obj[rx_object.interface_name][rx_object.rx_message_name][i];
                    switch(current_event.element_type){
                        case global.HMI_Element_Type.VIEWER_CONSOLE.type:
                            /*todo for the future*/
                            break;

                        case global.HMI_Element_Type.VIEWER_GAUGE.type:
                            var current_gauge = hmi_element_list[current_event.event_type][current_event.element_type][current_event.element_id];
                            data_viewer_obj[hmi_element_list[current_event.event_type][current_event.element_type][current_event.element_id].id]
                                .load({
                                columns: [[hmi_element_list[current_event.event_type][current_event.element_type][current_event.element_id].id,
                                    rx_object.msgObj[current_gauge._element_properties_obj.rx_intercept_attributes.message_field_number].value]]
                            });
                            break;

                        case global.HMI_Element_Type.VIEWER_GRAPH.type:
                            /*todo for the future*/
                            break;

                        case global.HMI_Element_Type.VIEWER_LED.type:
                            var current_led = hmi_element_list[current_event.event_type][current_event.element_type][current_event.element_id];
                            var indicator_length = current_led._element_properties_obj.led_attributes.indicator.length;
                            var indicatorFound = false;
                            for(var led = 0; led<indicator_length; led++){
                                if(current_led._element_properties_obj.led_attributes.indicator[led].value === rx_object.msgObj[current_led._element_properties_obj.rx_intercept_attributes.message_field_number].value){
                                    indicatorFound = true;
                                    $('#'+current_event.element_id+'_div .led span').css('background-color',current_led._element_properties_obj.led_attributes.indicator[led].color);
                                    $('#'+current_event.element_id+'_div .led-value').text(current_led._element_properties_obj.led_attributes.indicator[led].value);
                                }
                            }
                            if(indicatorFound == false){

                                $('#'+current_event.element_id+'_div .led span').css('background-color','#666666');
                                $('#'+current_event.element_id+'_div .led-value').text('value out of spec');
                            }
                            break;

                        case global.HMI_Element_Type.VIEWER_TABLE.type:
                            var current_table = hmi_element_list[current_event.event_type][current_event.element_type][current_event.element_id];
                            var current_table_data_obj = current_table._element_properties_obj.rx_intercept_attributes.interface_object_collection[rx_object.interface_name][rx_object.rx_message_name];
                            if(current_table_data_obj !== undefined) {
                                for (message_field in current_table_data_obj) {
                                    var value = rx_object.msgObj[current_table_data_obj[message_field].field_number].value;
                                    if(current_table_data_obj[message_field].conversion === 'h'){
                                        value = value.toString(16);
                                    }
                                    console.log('DEBUG TABLE', current_table_data_obj[message_field].data_index, value);
                                    data_viewer_obj[hmi_element_list[current_event.event_type][current_event.element_type][current_event.element_id].id]
                                        .bootstrapTable('updateRow', {
                                        index: current_table_data_obj[message_field].data_index,
                                        row: {
                                            value: value
                                        }
                                    });
                                }
                            }
                            break;
                    }
                }
            }
        }
    }catch(e){
        /*todo error manager*/
        console.log(e.toString(), e.message);
    }
}

function ReceiveMessageResponse(rx_message_name, interface_name) {
    try {
        if (respond_reply_arr[interface_name] !== undefined) {
            if (respond_reply_arr[interface_name][rx_message_name] !== undefined) {
                for (var id in respond_reply_arr[interface_name][rx_message_name]) {
                    var option = messages_in_transmission[id].type;

                    switch (option) {
                        case global.TransmitMessageTypes.RESPOND_REPLY.value:
                            for(manipulation in global.DataManipulationTypes) {
                                console.log('DEBUG','Manipulation type', global.DataManipulationTypes[manipulation], manipulation);
                                if(global.DataManipulationTypes[manipulation].name !== global.DataManipulationTypes.CONVERSION.name) {
                                    InternalFieldValueManipulation(messages_in_transmission[object.id].id,
                                        messages_in_transmission[object.id].interface_name,
                                        messages_in_transmission[object.id].id,
                                        messages_in_transmission[object.id]._message_arr,
                                        global.DataManipulationTypes[manipulation].name);
                                }
                            }
                            InternalFieldValueManipulation(messages_in_transmission[object.id].id,
                                messages_in_transmission[object.id].interface_name,
                                messages_in_transmission[object.id].id,
                                messages_in_transmission[object.id]._message_arr,
                                global.DataManipulationTypes.CONVERSION.name);

                            global.socket_master[urlId][messages_in_transmission[id].interface_name]
                                .primus.write(messages_in_transmission[id]);
                            break;
                        case global.TransmitMessageTypes.RESPOND_UNTIL.value:
                            global.socket_master[urlId][messages_in_transmission[id].interface_name]
                                .primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_REMOVE, id: id});
                            respond_reply_arr[interface_name][rx_message_name].splice(id, 1);
                            $('#' + id).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
                            break;
                    }
                }
            }
        }
    }
    catch
        (e) {
        /*todo error manager*/
        console.log(e);
    }
}

function CommunicationLinkerHandler(current_comms_intf_name){
    _comms_socket_obj[current_comms_intf_name].on('message', function(data){
        var dataObj = JSON.parse(data);
        if(dataObj.id === global.Linker_Communication_Enum.SERVER_CREATED){
            LinkerSocketClient(global.socket_master[urlId][current_comms_intf_name], current_comms_intf_name);
        }
        else if(dataObj.id === global.Linker_Communication_Enum.SERVER_ERROR){
            socket_obj.primus.on('data', function(data){
                console.log(data);
            });
        }
    });
}

function InitialiseLinkerProcess(current_comms_intf_name){
    var comms_execute_button_id = '#'+current_comms_intf_name + '_connect_button';
    jQuery(comms_execute_button_id).click(function(){
        var connectionStatus = jQuery('#'+current_comms_intf_name + '_connect_button').attr('comms_connected');
        var isConnected = (connectionStatus == 'true');
        if(isConnected === false){
            console.log('DEBUG_1:', 'spawn', current_comms_intf_name);
            _comms_socket_obj[current_comms_intf_name] = childProcess.spawn('node',
                ['./node_modules/linker/linker.js',
                    current_comms_intf_name,
                    global.socket_master[urlId][current_comms_intf_name].port_number,
                    urlId],
                {stdio: ['pipe', 'pipe', 'pipe','ipc']});

            console.log(current_comms_intf_name);
            console.log(global.socket_master);
            _comms_socket_obj[current_comms_intf_name].stdout.on('data', function(data){
                console.log(data.toString());

            });

            _comms_socket_obj[current_comms_intf_name].stderr.on('data', function(data){
                var error = error_list.INTERFACE_ERROR;
                _hmi.ErrorAlertCreator(
                    error_list.properties[error].type,
                    error_list.properties[error].name,
                    error_list.properties[error].message,
                    data,
                    current_comms_intf_name,
                    document);
            });

            _comms_socket_obj[current_comms_intf_name].on('message', function (data) {
                var dataObj = JSON.parse(data);
                if (dataObj.id === global.Communication_Linker_Emitter_Obj.KILL_LINKER) {
                    UdpSocketClose(current_comms_intf_name);
                }
                else{
                    console.log(data);
                }

            });

            _comms_socket_obj[current_comms_intf_name].on('exit', function(data){
                if(data !== null) {
                    global.socket_master[urlId][current_comms_intf_name].primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_CLOSE});
                    UdpSocketErrorClose(current_comms_intf_name);
                }
                else{
                    UdpSocketClose(current_comms_intf_name);
                }
           //     console.log(data);
            });

            _comms_socket_obj[current_comms_intf_name].on('error', function(data){
                global.socket_master[urlId][current_comms_intf_name].primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_CLOSE});
                UdpSocketErrorClose(current_comms_intf_name);
            });

            CommunicationLinkerHandler(current_comms_intf_name);
        }
        else if(isConnected === true){
           // UdpSocketClose(current_comms_intf_name);
            console.log('close', current_comms_intf_name);
            global.socket_master[urlId][current_comms_intf_name].primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_CLOSE});
        }
    });
}

/// <summary>
/// Create the interface layout HMI
/// </summary>
function InitialiseSingleCommunicationProcess() {
    jQuery(document).ready(function(){
        var comms_arr_length = _comms_arr.length;
        for(var i = 0; i < comms_arr_length; i++){
            InitialiseLinkerProcess(_comms_arr[i].name);
        }
    });
}

function InitialiseAllLinkerProcesses(){
    console.log('DEBUG', _comms_arr);
    jQuery(document).ready(function(){
        jQuery(comms_universal_button).click(function(){
            var universal_status = jQuery(comms_universal_button).attr('all_comms_connected');
            var isUniversalConnected = (universal_status == 'true');
            var comms_arr_length = _comms_arr.length;

            if(isUniversalConnected === false){
                for(var i = 0; i < comms_arr_length; i++){
                    var current_comms_intf_name = _comms_arr[i].name;
                    var single_connection_status = jQuery('#'+current_comms_intf_name + '_connect_button').attr('comms_connected');
                    var isSingleConnected = (single_connection_status == 'true');

                    console.log(global.socket_master, urlId, current_comms_intf_name);

                    if(isSingleConnected === false){
                        _comms_socket_obj[current_comms_intf_name] = childProcess.spawn('node',
                            ['./node_modules/linker/linker.js',
                                current_comms_intf_name,
                                global.socket_master[urlId][current_comms_intf_name].port_number,
                                urlId],
                            {stdio: ['pipe', 'pipe', 'pipe','ipc']});

                        _comms_socket_obj[current_comms_intf_name].on('message', function (data) {
                            var dataObj = JSON.parse(data);
                            if (dataObj.id === global.Communication_Linker_Emitter_Obj.KILL_LINKER) {
                                UdpSocketClose(current_comms_intf_name);
                            }
                            else{
                                console.log(data);
                            }

                        });

                        _comms_socket_obj[current_comms_intf_name].stdout.on('data', function(data){
                          //  console.log(data.toString());
                        });

                        _comms_socket_obj[current_comms_intf_name].stderr.on('data', function(data){
                            var error = error_list.INTERFACE_ERROR;
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error].type,
                                error_list.properties[error].name,
                                error_list.properties[error].message,
                                data,
                                current_comms_intf_name,
                                document);
                        });

                        _comms_socket_obj[current_comms_intf_name].on('exit', function(data){
                            if(data !== null) {
                                global.socket_master[urlId][current_comms_intf_name].primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_CLOSE});
                                UdpSocketErrorClose(current_comms_intf_name);
                            }
                            else{
                                UdpSocketClose(current_comms_intf_name);
                            }
                        //    console.log(data);
                        });

                        _comms_socket_obj[current_comms_intf_name].on('error', function(data){
                            console.log(data);
                            global.socket_master[urlId][current_comms_intf_name].primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_CLOSE});
                            UdpSocketErrorClose(current_comms_intf_name);
                        });

                        CommunicationLinkerHandler(current_comms_intf_name);
                    }
                }
            }
            else if(isUniversalConnected === true){
                for(var i = 0; i < comms_arr_length; i++){
                    var current_comms_intf_name = _comms_arr[i].name;
                    var single_connection_status = jQuery('#'+current_comms_intf_name + '_connect_button').attr('comms_connected');
                    var isSingleConnected = (single_connection_status == 'true');

                    if(isSingleConnected === true){
                        global.socket_master[urlId][current_comms_intf_name].primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_CLOSE});
                    }
                }
                jQuery(document).ready(function () {
                    jQuery(comms_universal_button).removeClass('icon-unlink').addClass('icon-link')
                        .attr('all_comms_connected', false)
                        .attr('title', global.GUI_Text_Enum.COMMS_ALL_ANCHOR_CONNECT)
                        .tooltip('fixTitle')
                        .data('bs.tooltip')
                        .$tip.find('.tooltip-inner')
                        .text(global.GUI_Text_Enum.COMMS_ALL_ANCHOR_CONNECT);
                });
            }
        });
    });
}

function UdpSocketClose(current_comms_intf_name){
    try {
        console.log(current_comms_intf_name + " : close UDP socket");
        jQuery('#'+ current_comms_intf_name + '_connect_status').text(global.GUI_Text_Enum.COMMS_LABEL_NOT_CONNECTED)
            .removeClass()
            .addClass('label label-default');
        jQuery('#'+ current_comms_intf_name + '_connect_button').text(global.GUI_Text_Enum.COMMS_BUTTON_CONNECT)
            .attr('comms_connected', false);

        if(_comms_socket_obj[current_comms_intf_name] !== undefined){
            _comms_socket_obj[current_comms_intf_name].kill('SIGKILL');
            _comms_socket_obj[current_comms_intf_name] = undefined;
        }
        global.socket_master[urlId][current_comms_intf_name].primus.end();
        ScriptCommsStatusUpdate(current_comms_intf_name, global.CommsStatusEnum.CLOSED);
    }
    catch(e){
       // console.log(e);
    }
}

function UdpSocketErrorClose(current_comms_intf_name){
    try {
        global.socket_master[urlId][current_comms_intf_name].primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_CLOSE});
        console.log(current_comms_intf_name + ": close UDP socket");
        jQuery('#'+ current_comms_intf_name + '_connect_status').text(global.GUI_Text_Enum.COMMS_LABEL_ERROR)
            .removeClass()
            .addClass('label label-danger');
        jQuery('#'+ current_comms_intf_name + '_connect_button').text(global.GUI_Text_Enum.COMMS_BUTTON_CONNECT)
            .attr('comms_connected', false);

        if(_comms_socket_obj[current_comms_intf_name] !== undefined){
             _comms_socket_obj[current_comms_intf_name].kill('SIGKILL');
            _comms_socket_obj[current_comms_intf_name] = undefined;
        }
        global.socket_master[urlId][current_comms_intf_name].primus.end();
        ScriptCommsStatusUpdate(current_comms_intf_name, global.CommsStatusEnum.CLOSED);
    }
    catch(e){
        console.log(e);
    }
}

function InitialiseGridster(){
    if(gridster === undefined) {
        gridster = $(".gridster > div").gridster({
            widget_margins: [10, 10],
            widget_base_dimensions: [150, 150],
            widget_selector: "li",
            extra_rows: 100,
            extra_cols: 8,
            helper: 'clone',
            avoid_overlapped_widgets: true,
            autogenerate_stylesheet: true,
            resize: {
                enabled: true,
                min_size: [1, 1]
            }
        }).data('gridster');
    }
}

function EnableGridster(){
    gridster.enable();
    gridster.enable_resize();
    jQuery(".gridster > div").css('background-color','whitesmoke');
    $('.hmi_element')
        .prop('disabled', true);
}

function DisableGridster(){
    _hmi_serialize_collection = [];
    gridster.disable();
    $(".gridster > div").gridster({
        draggable:{
            ignore_dragging: true
        }
    }).data('gridster');
    gridster.disable_resize();
    jQuery(".gridster > div").css('background-color','#333');
    $('.hmi_element')
        .prop('disabled', false);
    _hmi_serialize_collection = gridster.serialize();
    hmi_configuration.grid = _hmi_serialize_collection;
    jf.writeFileSync(hmi_file_path, hmi_configuration);
}

function InitialiseGridContainers(){
    console.log('widget added at ', this.col, this.row);
    gridster.add_widget('<div class="gs-w child_container" ></div>', this.size_x, this.size_y, this.col, this.row);
}

function AddGridContainer(event){
    event.preventDefault();
    gridster.add_widget('<div class="gs-w child_container" ></div>', 1, 1);
}

function RemoveGridContainer(event, delete_event_id){
    var delete_selected_value = jQuery(delete_event_id).attr('delete-active');
    var delete_selected_status = (delete_selected_value == 'true');

    event.preventDefault();

    if(delete_selected_status === false){
        jQuery(delete_event_id).attr('delete-active', true).css('color', '#ff4444').tooltip('show');
        $(document).on( "click", ".gridster div div", function() {
            $(this).addClass("activ");
            gridster.remove_widget($('.activ'),false);
        });
    }
    else if(delete_selected_status === true){
        jQuery(delete_event_id).attr('delete-active', false).css('color', 'whitesmoke').tooltip('hide');
        $(document).on( "click", ".gridster div div", function() {
            $(this).addClass("activ");
            gridster.remove_widget($('.activ'),false);
        }).off('click');
    }
}

function TheFinalSolutionToTheGridProblem(){
    $('#hmi_div div .child_container').each(function(i) {
        gridster.remove_widget( $('.child_container').eq(i) );
        console.log('removed widget ',i);
    });
}

function SaveAsHmi(e){
    var SaveAsWarningAlertHmi_id = '#SaveAsWarningAlertHmi',
        SaveAsHmi_fileInput_id = '#SaveAsHmi_fileInput';

    var fileName = jQuery(SaveAsHmi_fileInput_id).val();
    console.log(fileName);
    if (fileName === null) {
        e.preventDefault();
        $(SaveAsWarningAlertHmi_id).slideDown(400);
    }
    else{
        var extensionType = fileName.substr(fileName.lastIndexOf('.')+1);
        if(extensionType === 'json'){
            $(SaveAsWarningAlertHmi_id).slideUp(400);
            hmi_configuration.grid = _hmi_serialize_collection;
            jf.writeFileSync(fileName, hmi_configuration);
            $("#"+SaveAsHmi_modal).modal('hide');
        }
        else{
            e.preventDefault();
            $(SaveAsWarningAlertHmi_id).slideDown(400);
        }
    }
}

function SaveAsDefaultHmi(e){
    var SaveAsHmi_fileInput_id = '#SaveAsHmi_fileInput';
    var fileName = jQuery(SaveAsHmi_fileInput_id).val(),
        SaveAsWarningAlertHmi_id = '#SaveAsWarningAlertHmi';

    console.log(fileName);
    if (fileName === null) {
        e.preventDefault();
        $(SaveAsWarningAlertHmi_id).slideDown(400);
    }
    else{
        var extensionType = fileName.substr(fileName.lastIndexOf('.')+1);
        if(extensionType === 'json'){
            $(SaveAsWarningAlertHmi_id).slideUp(400);
            hmi_configuration.grid = _hmi_serialize_collection;
            jf.writeFileSync(fileName, hmi_configuration);
            for (var j = 0; j < global.main_configuration.simulators.length; j++) {
                if (urlId === global.main_configuration.simulators[j].id) {
                    global.main_configuration.simulators[j].HMI_file_path = fileName;
                    var hmi_arr_length = global.main_configuration.hmi_storage[global.main_configuration.simulators[j].interface_file_name].length;
                    var isStored = false;
                    for(var k=0; k<hmi_arr_length; k++){
                        var current_stored_file = global.main_configuration.hmi_storage[global.main_configuration.simulators[j].interface_file_name][k];
                        if(fileName === current_stored_file){
                            isStored = true;
                        }
                    }
                    if(isStored === true){
                        /*todo error/warning manager: choosing same file*/
                    }
                    if(isStored === false){
                        global.main_configuration.hmi_storage[global.main_configuration.simulators[j].interface_file_name].push(fileName);
                    }
                    jf.writeFile(global.configFile, global.main_configuration);
                }
            }
            $("#"+SaveAsHmi_modal).modal('hide');
        }
        else{
            e.preventDefault();
            $(SaveAsWarningAlertHmi_id).slideDown(400);
        }
    }
}

function SaveAsWarningAlertHmi(e){
    // Find all elements with the "alert" class, get all descendant elements with the class "close", and bind a "click" event handler
    e.stopPropagation();    // Don't allow the click to bubble up the DOM
    e.preventDefault();    // Don't let any default functionality occur (in case it's a link)
    $(this).closest(".alert").slideUp(400);    // Hide this specific Alert
}

function HmiTooltipCreate(new_element_id, resizable_is_enabled){
    $('#'+new_element_id).tooltipster({
        content: $('<div class="hmi_configuration_types" resizable_enable='+resizable_is_enabled+' element_id="'+new_element_id+'"><a href="#" class="hmi_configuration_toolbar" configuration_type="hmi_element_move"  ><em class="fa fa-arrows"></em></a><a href="#" class="hmi_configuration_toolbar" configuration_type="hmi_element_edit"  ><em class="fa fa-edit"></em></a><a href="#" class="hmi_configuration_toolbar" configuration_type="hmi_element_remove"><em class="fa fa-trash-o" ></em></a><div></div>'),
        trigger: 'hover',
        interactive: true
    });
}

function HmiTooltipChildCreate(child_id, parent_id, child_type){
    $('#'+child_id+'_div').tooltipster({
        content: $('<div class="hmi_configuration_types" element_id="'+child_id+'" parent_id="'+parent_id+'" element_type="'+child_type+'"><a href="#" class="hmi_child_configuration_toolbar" configuration_type="hmi_element_move"  ><em class="fa fa-arrows"></em></a><a href="#" class="hmi_child_configuration_toolbar" configuration_type="hmi_element_edit"  ><em class="fa fa-edit"></em></a><a href="#" class="hmi_child_configuration_toolbar" configuration_type="hmi_element_remove"><em class="fa fa-trash-o" ></em></a><div></div>'),
        trigger: 'hover',
        interactive: true
    });
}

function HmiTooltipEnable(){
    $('.hmi_element')
        .prop('disabled', false)
        .tooltipster('enable');
}

function HmiTooltipDisable(){
    $('.hmi_element')
        .prop('disabled', false)
        .tooltipster('disable');
}

function HmiTooltipExecute(event, this_configuration) {
    var element_id = $(this_configuration).parent().attr('element_id');
    var enableResizable = ($(this_configuration).parent().attr('resizable_enable') == 'true');
    var configuration_type = $(this_configuration).attr('configuration_type');
    var element_arr = element_id.split('-');
    var gridster_element_id = element_id + '-li';

    var event_type = element_arr[0],
        element_type = element_arr[1];

    event.preventDefault();

    switch (configuration_type) {
        case global.HMI_Element_Configuration_Type_Enum.MOVE:
            $('#' + element_id + '_div')
                .draggable({
                    cancel: false,
                    cursor: "move",
                    containment: "parent",
                    disabled: false,
                    grid: [ 5, 5 ],
                    drag: function(){
                        $('#' + element_id).prop('disabled',true);
                    },
                    start: function(){
                        $('#' + element_id).prop('disabled',true);
                    },
                    stop: function () {
                        var offset = $('#' + element_id + '_div')
                            .position();
                        $('#' + element_id).prop('disabled',false);
                        console.log('new offset',offset);
                        hmi_element_list[event_type][element_type][element_id].offset = offset;
                    }
                });
                if(enableResizable == true) {
                    $('#' + element_id + '_div')
                        .resizable({
                            disabled: false,
                            grid: [ 5, 5 ],
                            containment: "parent",
                            alsoResize: '#' + element_id,
                            drag: function () {
                                $('#' + element_id).prop('disabled', true);
                            },
                            start: function () {
                                $('#' + element_id).prop('disabled', true);
                            },
                            stop: function () {
                                $('#' + element_id).prop('disabled', false);
                                var dimensions = {
                                    height: $('#' + element_id).height(),
                                    width: $('#' + element_id).width()
                                };
                                console.log('new dimensions', dimensions);
                                hmi_element_list[event_type][element_type][element_id].dimension = dimensions;
                            }
                        });
                }
            break;

        case global.HMI_Element_Configuration_Type_Enum.REMOVE:
            console.log('remove');
            $('#' + element_id + '_div').remove();
            delete hmi_element_gridster_arr[element_id];
            delete hmi_element_list[event_type][element_type][element_id];
            for(var gui_type in hmi_element_list.user_data_manipulators) {
                if (hmi_element_list.user_data_manipulators[gui_type][element_id] !== undefined) {
                    console.log('DEBUG', 'delete user data manip',gui_type, element_id, hmi_element_list.user_data_manipulators);
                    console.log('DEBUG', 'gridster arr',hmi_element_gridster_arr);
                    for(var child in hmi_element_list.user_data_manipulators[gui_type][element_id]) {
                        $('#' + child + '_div').remove();
                        delete hmi_element_list.user_data_manipulators[gui_type][element_id][child];
                    }
                }
            }
            break;

        case global.HMI_Element_Configuration_Type_Enum.EDIT:
            console.log('edit');
            HmiElementConfiguration(event_type, element_id, element_type, hmi_element_list[event_type][element_type][element_id]._element_properties_obj);
            break;
    }
    /*TODO save in gui json file*/
}

function HmiChildTooltipExecute(event, this_configuration) {
    var element_id = $(this_configuration).parent().attr('element_id'),
        parent_id = $(this_configuration).parent().attr('parent_id'),
        element_type = $(this_configuration).parent().attr('element_type'),
        event_type = 'user_data_manipulators',
        configuration_type = $(this_configuration).attr('configuration_type'),
        parent_arr = parent_id.split('-'),
        parent_event_type = parent_arr[0],
        parent_element_type = parent_arr[1];

    event.preventDefault();

    switch (configuration_type) {
        case global.HMI_Element_Configuration_Type_Enum.MOVE:
            $('#' + element_id + '_div')

                .draggable({
                    cancel: false,
                    cursor: "move",
                    containment: "parent",
                    disabled: false,
                    grid: [ 5, 5 ],
                    drag: function () {
                        $('#' + element_id + '_' + element_type).prop('disabled', true);
                    },
                    start: function () {
                        $('#' + element_id + '_' + element_type).prop('disabled', true);
                    },
                    stop: function () {
                        var offset = $('#' + element_id + '_div')
                            .position();
                        $('#' + element_id + '_' + element_type).prop('disabled', false);
                        hmi_element_list[event_type][element_type][parent_id][element_id].offset = offset;
                    }
                });
            break;

        case global.HMI_Element_Configuration_Type_Enum.REMOVE:
            console.log('remove');
            $('#' + element_id + '_div').remove();
            delete hmi_element_gridster_arr[element_id];
            delete hmi_element_list[event_type][element_type][element_id];
            if (hmi_element_list[event_type][element_type][parent_id][element_id] !== undefined) {
                delete hmi_element_list[event_type][element_type][parent_id][element_id];
            }
            break;

        case global.HMI_Element_Configuration_Type_Enum.EDIT:
            console.log('edit');
            /*edit the parent*/
            HmiElementConfiguration(parent_event_type, parent_id, parent_element_type, hmi_element_list[parent_event_type][parent_element_type][parent_id]._element_properties_obj);
            break;
    }
}

function HmiElementConfiguration(event_type, element_id, element_type, configuration){
    switch (element_type){
        case global.HMI_Element_Type.IO_BUTTON.type:
            var button_modal_id = _hmi.ButtonEditor(configuration, _comms_obj, document, function(new_button_config){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_button_config);
                ElementAttributeConfiguration(event_type, element_type, element_id);

                /*button gui attributes*/
                for(var gui_type in hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui) {
                    for (var gui_item in hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type]) {
                        var gui_item_id = element_id +'_'+ hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_name
                            +'_'+hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_number;
                        if(hmi_element_list.user_data_manipulators[gui_type][element_id] === undefined){
                            hmi_element_list.user_data_manipulators[gui_type][element_id] = {};
                        }
                        hmi_element_list.user_data_manipulators[gui_type][element_id][gui_item_id] = {
                            id: gui_item_id,
                            parent_id: element_id,
                            attributes: hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].attribute,
                            message_field: hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_name,
                            message_field_number: hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_number,
                            element_type: gui_type
                        };
                        CreateNewChildElement(hmi_element_list.user_data_manipulators[gui_type][element_id][gui_item_id], hmi_element_list[event_type][element_type][element_id], gui_item_id);
                    }
                }
            });
            $(button_modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;


        case global.HMI_Element_Type.IO_BUTTON_SCENARIO.type:
            var scenario_modal_id = _hmi.ScenarioEditor(configuration, _comms_obj, document, function(new_scenario_config){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_scenario_config);
                ElementAttributeConfiguration(event_type, element_type, element_id);

                /*button gui attributes*/
                for(var gui_type in hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui) {
                    for (var gui_item in hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type]) {
                        var gui_item_id = hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_name
                            +'_'+hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_number;
                        if(hmi_element_list.user_data_manipulators[gui_type][element_id] === undefined){
                            hmi_element_list.user_data_manipulators[gui_type][element_id] = {};
                        }
                        hmi_element_list.user_data_manipulators[gui_type][element_id][gui_item_id] = {
                            id: gui_item_id,
                            parent_id: element_id,
                            attributes: hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].attribute,
                            message_field: hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_name,
                            message_field_number: hmi_element_list[event_type][element_type][element_id]._element_properties_obj.gui[gui_type][gui_item].message_field_number,
                            element_type: gui_type
                        };
                        CreateNewChildElement(hmi_element_list.user_data_manipulators[gui_type][element_id][gui_item_id], hmi_element_list[event_type][element_type][element_id], gui_item_id);
                    }
                }
            });

            $(scenario_modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;

        case global.HMI_Element_Type.IO_BUTTON_SCRIPT.type:
            console.log('DEBUG','script list', _script_list);
            var script_modal_id = _hmi.ScriptEditor(configuration, _script_list, document, function(new_script_config) {
                console.log('DEBUG','return object', new_script_config);
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_script_config);
                ElementAttributeConfiguration(event_type, element_type, element_id);
            });
            $(script_modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;

       // case global.HMI_Element_Type.IO_BUTTON_INPUT.type:
      //      break;
     //   case global.HMI_Element_Type.IO_BUTTON_DROPDOWN.type:
            /*todo*/
            //AppendNewElementToContainer();
      //      break;
     //   case global.HMI_Element_Type.IO_BUTTON_INPUT_DROPDOWN.type:
            /*todo*/
            //AppendNewElementToContainer();
     //       break;


        case global.HMI_Element_Type.VIEWER_TABLE.type:
            var button_modal_id = _hmi.TableEditor(configuration, _comms_obj, document, function(new_gauge_config){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_gauge_config);
                ElementAttributeConfiguration(event_type, element_type, element_id);
            });
            $(button_modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;


        case global.HMI_Element_Type.VIEWER_GAUGE.type:
            var button_modal_id = _hmi.GaugeEditor(configuration, _comms_obj, document, function(new_gauge_config){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_gauge_config);
                ElementAttributeConfiguration(event_type, element_type, element_id);
            });
            $(button_modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;


        case global.HMI_Element_Type.VIEWER_LED.type:
            var button_modal_id = _hmi.LedEditor(configuration, _comms_obj, document, function(new_gauge_config){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_gauge_config);
                ElementAttributeConfiguration(event_type, element_type, element_id);
            });
            $(button_modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;

     //   case global.HMI_Element_Type.VIEWER_CONSOLE.type:
            /*todo*/
            //AppendNewElementToContainer();
     //       break;
        //   case global.HMI_Element_Type.VIEWER_GRAPH.type:
        /*todo*/
        //AppendNewElementToContainer();
        //       break;


     //   case global.HMI_Element_Type.CONTAINER_TAB.type:
            /*todo*/
            //AppendNewElementToContainer();
       //     break;
       // case global.HMI_Element_Type.CONTAINER_PANEL.type:
            /*todo*/
            //AppendNewElementToContainer();
        //    break;
        //case global.HMI_Element_Type.CONTAINER_CAROUSEL.type:
            /*todo*/
            //AppendNewElementToContainer();
         //   break;


        case global.HMI_Element_Type.ACCESSORY_TEXT.type:
            var modal_id = _hmi.TextEditor(configuration, document, function(new_text){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_text);
                ElementAttributeConfiguration(event_type, element_type, element_id);
            });
            $(modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;


        case global.HMI_Element_Type.ACCESSORY_LABEL.type:
            var modal_id = _hmi.TextEditor(configuration, document, function(new_text){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_text);

                var dimensions = {
                    height: $('#' + element_id ).height(),
                    width: $('#' + element_id).width()
                };
                hmi_element_list[event_type][element_type][element_id].dimension = dimensions;
                console.log('width dimensions', dimensions);

                ElementAttributeConfiguration(event_type, element_type, element_id);
            });
            $(modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;


        case global.HMI_Element_Type.ACCESSORY_IMAGE.type:
            var modal_id = _hmi.ImageEditor(configuration, document, function(new_image){
                hmi_element_list[event_type][element_type][element_id]._element_properties_obj = deepcopy(new_image);

                var dimensions = {
                    height: $('#' + element_id ).height(),
                    width: $('#' + element_id).width()
                };
                hmi_element_list[event_type][element_type][element_id].dimension = dimensions;
                console.log('width dimensions', dimensions);

                ElementAttributeConfiguration(event_type, element_type, element_id);
            });
            $(modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
            break;
    }
}

function CreateNewChildElement(child_config, parent_config, child_id){
    switch (child_config.element_type) {
        case global.HMI_Element_Type.DATA_MANIPULATOR_SLIDER.type:
            switch (parent_config.parent.parent_type) {
                case global.StorageTypes.GRID.value:
                    $('#hmi_div div .child_container:eq(' + parent_config.parent.parent_id + ')')
                        .append('<div id="' + child_id + '_div' + '" class="hmi_element hmi_element_containment main_slider_container"><span type="label" for="' + child_id + '_slider' + '" class="label label-default slider_label" id="' + child_id + '_label' + '"></span ><div id="' + child_id + '_container' + '" class="slider_container"><div id="' + child_id + '_slider' + '" class="slider_element"></div><div class="slider_text"><p type="text" id="' + child_id + '_value' + '" ></p></div></div></div>');
                    break;
            /*    case global.StorageTypes.PANELS.value:
                    break;
                case global.StorageTypes.TABS.value:
                    break;
                case global.StorageTypes.CAROUSEL.value:
                    break;*/
            }

            var dimensions = {
                height: $('#' + child_id + '_div').height(),
                width: $('#' + child_id + '_div').width()
            };

            var offset = $('#' + child_id + '_div').position();

            $('#' + child_id + '_div')
                .css({
                    position: "absolute",
                    top: offset.top,
                    left: offset.left
                });

            child_config.offset = offset;
            child_config.dimension = dimensions;

            console.log(child_config);
            $('#' + child_id + '_label').text(child_config.attributes.name);
            $('#' + child_id + '_value').text(parent_config._element_properties_obj._messageArr[child_config.message_field_number].value + child_config.attributes.unit);

            d3.select('#' + child_id + '_slider').call(d3.slider()
                .value(parent_config._element_properties_obj._messageArr[child_config.message_field_number].value)
                .min(child_config.attributes.begin)
                .max(child_config.attributes.end)
                .step(child_config.attributes.interval)
                .axis(true)
                //.orientation(child_config.attributes.type)
                .on("slide", function (evt, value) {
                    d3.select('#' + child_id + '_value').text(value + child_config.attributes.unit);
                    parent_config._element_properties_obj._messageArr[child_config.message_field_number].value = value;
                }));
            HmiTooltipChildCreate(child_id, child_config.parent_id, child_config.element_type);
            break;

        case global.HMI_Element_Type.DATA_MANIPULATOR_INPUT.type:
            switch (parent_config.parent.parent_type) {
                case global.StorageTypes.GRID.value:
                    $('#hmi_div div .child_container:eq(' + parent_config.parent.parent_id + ')')
                        .append('<div id="' + child_id + '_div' + '" class="hmi_element hmi_element_containment input-group-sm data_manip_div">' +
                            '<span class="input-group-addon data_manip_label" id="' + child_id + '_label' + '">' + child_config.attributes.name +
                            '</span>' +
                            '<input type="text" class="form-control data_manip_input" id="' + child_id + '" >' +
                            '<span class="input-group-addon data_manip_label" id="' + child_id + '_unit' + '" >' + child_config.attributes.unit +
                            '</span>' +
                            '<span class="input-group-btn data_manip_label">'+
                            '<button class="btn btn-default " type="button" id="' + child_id + '_button' + '">' +
                            '<span class="glyphicon glyphicon-ok">' +
                            '</span>' +
                            '</button>' +
                            '</span>'+
                            '</div>');
                    break;
           /*     case global.StorageTypes.PANELS.value:
                    break;
                case global.StorageTypes.TABS.value:
                    break;
                case global.StorageTypes.CAROUSEL.value:
                    break;*/
            }

            var dimensions = {
                height: $('#' + child_id + '_div').height(),
                width: $('#' + child_id + '_div').width()
            };

            var offset = $('#' + child_id + '_div').position();

            child_config.offset = offset;
            child_config.dimension = dimensions;

            $('#' + child_id + '_div')
                .css({
                    position: "absolute",
                    top: offset.top,
                    left: offset.left
                });

            $('#' + child_id)
                .val(parent_config._element_properties_obj._messageArr[child_config.message_field_number].value);

            $('#' + child_id)
                .val(parent_config._element_properties_obj._messageArr[child_config.message_field_number].value)
                .on('keypress', function(){
                    $('#'+ child_id +'_button').css({'background': 'red'});
                });

            $('#'+ child_id +'_button').on('click', function(){
                var value = $('#' + child_id).val();
                parent_config._element_properties_obj._messageArr[child_config.message_field_number].value = value;
                $(this).css({'background': 'green'});
            });

            HmiTooltipChildCreate(child_id, child_config.parent_id, child_config.element_type);
            break;
    }
}

function AppendExistingChildElement(child_config, parent_config, child_id){
    switch (child_config.element_type){
        case global.HMI_Element_Type.DATA_MANIPULATOR_SLIDER.type:
            switch(parent_config.parent.parent_type){
                case global.StorageTypes.GRID.value:
                    $('#hmi_div div .child_container:eq('+parent_config.parent.parent_id+')')
                        .append('<div id="'+child_id+'_div'+'" class="hmi_element hmi_element_containment main_slider_container">'+
                            '<span type="label" for="'+child_id+'_slider'+'" class="label label-default slider_label" id="'+child_id+'_label'+'"></span ><div id="'+child_id+'_container'+'" class="slider_container"><div id="'+child_id+'_slider'+'" class="slider_element"></div><div class="slider_text"><p type="text" id="'+child_id+'_value'+'" ></p></div></div></div>');
                    break;
            /*    case global.StorageTypes.PANELS.value:
                    break;
                case global.StorageTypes.TABS.value:
                    break;
                case global.StorageTypes.CAROUSEL.value:
                    break;*/
            }

            $('#'+child_id+'_div')
                .css({
                    position: "absolute",
                    top: child_config.offset.top,
                    left: child_config.offset.left
                });

            $('#'+child_id+'_label').text(child_config.attributes.name);
            $('#'+child_id+'_value').text(parent_config._element_properties_obj._messageArr[child_config.message_field_number].value+child_config.attributes.unit);

            d3.select('#'+child_id+'_slider').call(d3.slider()
                .value(parent_config._element_properties_obj._messageArr[child_config.message_field_number].value)
                .min(child_config.attributes.begin)
                .max(child_config.attributes.end)
                .step(child_config.attributes.interval)
                .axis(true)
                //.orientation(child_config.attributes.type)
                .on("slide", function(evt, value) {
                    d3.select('#'+child_id+'_value').text(value+child_config.attributes.unit);
                    parent_config._element_properties_obj._messageArr[child_config.message_field_number].value = value;
                }));
            HmiTooltipChildCreate(child_id, child_config.parent_id, child_config.element_type);
            break;

        case global.HMI_Element_Type.DATA_MANIPULATOR_INPUT.type:
            switch (parent_config.parent.parent_type) {
                case global.StorageTypes.GRID.value:
                    $('#hmi_div div .child_container:eq(' + parent_config.parent.parent_id + ')')
                        .append('<div id="' + child_id + '_div' + '" class="hmi_element hmi_element_containment input-group-sm data_manip_div">' +
                            '<span class="input-group-addon data_manip_label" id="' + child_id + '_label' + '">' + child_config.attributes.name +
                            '</span>' +
                            '<input type="text" class="form-control data_manip_input" id="' + child_id + '" >' +
                            '<span class="input-group-addon data_manip_label" id="' + child_id + '_unit' + '" >' + child_config.attributes.unit +
                            '</span>' +
                            '<span class="input-group-btn data_manip_label">'+
                            '<button class="btn btn-default " type="button" id="' + child_id + '_button' + '">' +
                            '<span class="glyphicon glyphicon-ok">' +
                            '</span>' +
                            '</button>' +
                            '</span>'+
                            '</div>');
                    break;
           /*     case global.StorageTypes.PANELS.value:
                    break;
                case global.StorageTypes.TABS.value:
                    break;
                case global.StorageTypes.CAROUSEL.value:
                    break;*/
            }

            $('#'+child_id+'_div')
                .css({
                    position: "absolute",
                    top: child_config.offset.top,
                    left: child_config.offset.left
                });

            $('#' + child_id)
                .val(parent_config._element_properties_obj._messageArr[child_config.message_field_number].value)
                .on('keypress', function(){
                    $('#'+ child_id +'_button').css({'background': 'red'});
                });

            $('#'+ child_id +'_button').on('click', function(){
                var value = $('#' + child_id).val();
                parent_config._element_properties_obj._messageArr[child_config.message_field_number].value = value;
                $(this).css({'background': 'green'});
            });

            HmiTooltipChildCreate(child_id, child_config.parent_id, child_config.element_type);
            break;
    }
}

function AddToReceiveListenerArr(interface_name, message_name, event_type, element_type, element_id) {
    if (rx_event_listeners_obj[interface_name] === undefined) {
        rx_event_listeners_obj[interface_name] = {};
    }
    if (rx_event_listeners_obj[interface_name][message_name] === undefined) {
        rx_event_listeners_obj[interface_name][message_name] = [];
    }
    rx_event_listeners_obj[interface_name][message_name].push({
        event_type: event_type,
        element_type: element_type,
        element_id: element_id
    });
}

function ElementAttributeConfiguration(event_type, element_type, element_id){
    var current_element = hmi_element_list[event_type][element_type][element_id];
    switch (current_element.element_type){
        case global.HMI_Element_Type.IO_BUTTON.type:
            $('#'+current_element.id)
            .text(current_element._element_properties_obj.attributes.name);
            if(current_element._element_properties_obj._transmit_options.transmit_option !== global.TransmitMessageTypes.SINGLE.value){
                $('#'+current_element.id)
                .removeClass('btn-default')
                .addClass('btn-success')
                .attr('isActive',false);
            }

            console.log('DEBUG', 'IO BUTTON', current_element._element_properties_obj);
            var message_size = current_element._element_properties_obj._messageArr.length;
            for(var i=0; i<message_size; i++){
                var current_message_field_obj = current_element._element_properties_obj._messageArr[i];
                console.log('DEBUG', 'manipulation objects', current_message_field_obj.isManipulated, current_message_field_obj.data_manipulation.type);
                if(current_message_field_obj.isManipulated == true &&
                    (current_message_field_obj.data_manipulation.type === global.DataManipulationTypes.COUNTER.name ||
                     current_message_field_obj.data_manipulation.type === global.DataManipulationTypes.COPY.name)){

                    if(internal_field_manipulators_list[current_element.id] === undefined) {
                        console.log('DEBUG', '1st obj is empty');
                        internal_field_manipulators_list[current_element.id] = {};
                    }
                    if(internal_field_manipulators_list[current_element.id]
                        [current_element._element_properties_obj._message_attribute.interface_name] === undefined){
                        console.log('DEBUG', '2nd obj is empty');
                        internal_field_manipulators_list[current_element.id]
                            [current_element._element_properties_obj._message_attribute.interface_name] = {}
                    }
                    if(internal_field_manipulators_list[current_element.id]
                        [current_element._element_properties_obj._message_attribute.interface_name]
                        [current_message_field_obj.data_manipulation.type] === undefined){
                        console.log('DEBUG', '3rd obj is empty');
                        internal_field_manipulators_list[current_element.id]
                            [current_element._element_properties_obj._message_attribute.interface_name]
                            [current_message_field_obj.data_manipulation.type] = {};
                    }
                    if(internal_field_manipulators_list[current_element.id]
                        [current_element._element_properties_obj._message_attribute.interface_name]
                        [current_message_field_obj.data_manipulation.type]
                        [current_element.id] === undefined){
                        console.log('DEBUG', 'ARR is empty');
                        internal_field_manipulators_list[current_element.id]
                            [current_element._element_properties_obj._message_attribute.interface_name]
                            [current_message_field_obj.data_manipulation.type]
                            [current_element.id]= [];
                    }
                    /*todo get something better for message name**/
                    console.log('DEBUG', 'INTERNAL MANIP READY FOR INSERTION', current_message_field_obj.name, i);

                    internal_field_manipulators_list[current_element.id]
                        [current_element._element_properties_obj._message_attribute.interface_name]
                        [current_message_field_obj.data_manipulation.type]
                        [current_element.id].push({
                            message_field_name: current_message_field_obj.name,
                            message_field_number: i,
                            attributes: current_message_field_obj.data_manipulation.attribute
                        });
                }

                /*todo add extra manipulator attributes*/
            }
            IoButtonExecute(current_element);
            break;


        case global.HMI_Element_Type.IO_BUTTON_SCENARIO.type:
            break;

        case global.HMI_Element_Type.IO_BUTTON_SCRIPT.type:
            $('#'+current_element.id)
                .text(current_element._element_properties_obj.attributes.name);

            $('#'+current_element.id)
                .removeClass('btn-default')
                .addClass('btn-success')
                .attr('isActive',false);

            IoScriptExecute(current_element);
            break;

      /*  case global.HMI_Element_Type.IO_BUTTON_INPUT.type:
            break;
        case global.HMI_Element_Type.IO_BUTTON_DROPDOWN.type:
            break;
        case global.HMI_Element_Type.IO_BUTTON_INPUT_DROPDOWN.type:
            break;
        case global.HMI_Element_Type.VIEWER_GRAPH.type:
            break;
*/
        case global.HMI_Element_Type.VIEWER_TABLE.type:
            $('#'+current_element.id+'_div')
                .empty()
                .css({'color':'black'})
                .append('' +
                '<table id="'+current_element.id+'">' +
                '</table>');

                data_viewer_obj[current_element.id] = $('#'+current_element.id)
                .bootstrapTable({
                method: 'get',
                data: current_element._element_properties_obj.rx_intercept_attributes.table_array_collection,
                cache: false,
                striped: false,
                pagination: false,
                hover: true,
                search: false,
                columns: [
                    {
                        field: 'interface',
                        title: 'interface',
                        align: 'left',
                        valign: 'bottom',
                        sortable: false
                    },
                    {
                        field: 'message',
                        title: 'message name',
                        align: 'left',
                        valign: 'bottom',
                        sortable: false
                    },
                    {
                        field: 'field_name',
                        title: 'field name',
                        align: 'left',
                        valign: 'bottom',
                        sortable: false
                    },
                    {
                        field: 'key',
                        title: 'type',
                        align: 'left',
                        valign: 'bottom',
                        sortable: false
                    },
                    {
                        title: 'value',
                        field: 'value',
                        align: 'right',
                        valign: 'bottom',
                        width: 10,
                        sortable: false
                    }
                ]
            });

            $('#'+current_element.id)
                .addClass('hmi_element');

            $('#'+current_element.id+'_div')
                .css({
                    position: "absolute",
                    top: current_element.offset.top,
                    left: current_element.offset.left
                });

            HmiTooltipCreate(current_element.id, false);

            for(interface_name in current_element._element_properties_obj.rx_intercept_attributes.interface_object_collection){
                for(message_name in current_element._element_properties_obj.rx_intercept_attributes.interface_object_collection[interface_name]){
                    AddToReceiveListenerArr(interface_name, message_name,event_type,element_type,element_id);
                }
            }
            break;

        case global.HMI_Element_Type.VIEWER_GAUGE.type:
            var gauge_properties = current_element._element_properties_obj;
            var indicator_value_arr = [],
                indicator_color_arr = [];

             var dimensions = {
             height: 180,
             width: 280
             };
             current_element.dimension = dimensions;

            var indicator_size = gauge_properties.gauge_attributes.indicator.length;
            for(var i = 0; i<indicator_size; i++){
                indicator_value_arr.push(gauge_properties.gauge_attributes.indicator[i].value);
                indicator_color_arr.push(gauge_properties.gauge_attributes.indicator[i].color);
            }

            var offset = $('#'+current_element.id).position();

            $('#'+current_element.id+'_div').empty().css({
                position: "absolute",
                top: current_element.offset.top,
                left: current_element.offset.left,
                height: dimensions.height,
                width: dimensions.width
            });

            $('#'+current_element.id+'_div')
                .append('<span  type="label" class="label label-default" style="display: inline-block; font-size: 14px">'+
                    gauge_properties.gauge_attributes.name +
                    '</span >' +
                    '<div id="'+current_element.id+'" class="hmi_element">' +
                    '</div>');

            $('#'+current_element.id).empty().css({
                height: dimensions.height,
                width: dimensions.width
            });

            data_viewer_obj[current_element.id] = c3.generate({
                bindto: '#'+current_element.id,
                data: {
                    columns: [
                        [current_element.id, gauge_properties.gauge_attributes.minimum]
                    ],
                    type: 'gauge'
                },
                gauge: {
                    label: {
                        format: function (value, ratio) {
                            return value;
                        },
                        show: true // to turn off the min/max labels.
                    },
                    min: gauge_properties.gauge_attributes.minimum, // 0 is default, //can handle negative min e.g. vacuum / voltage / current flow / rate of change
                    max: gauge_properties.gauge_attributes.maximum, // 100 is default
                    units: gauge_properties.gauge_attributes.unit,
                    width: 50, // for adjusting arc thickness
                    expand: true
                },
                color: {
                    pattern: indicator_color_arr, // the three color levels for the percentage values.
                    threshold: {
                        unit: '', // percentage is default
                        max: gauge_properties.gauge_attributes.maximum, // 100 is default
                        values: indicator_value_arr
                    }
                },
                size: {
                    height: 150
                }            
            });
            HmiTooltipCreate(current_element.id, false);
            AddToReceiveListenerArr(gauge_properties.rx_intercept_attributes.interface, gauge_properties.rx_intercept_attributes.message ,event_type,element_type,element_id);
            break;


        case global.HMI_Element_Type.VIEWER_LED.type:
            console.log('LED   DEBUG', current_element);
            var led_properties = current_element._element_properties_obj;
            $('#'+current_element.id+'_div .led-header').text(led_properties.led_attributes.name);
            AddToReceiveListenerArr(led_properties.rx_intercept_attributes.interface, led_properties.rx_intercept_attributes.message,event_type,element_type,element_id);
            break;

    /*    case global.HMI_Element_Type.VIEWER_CONSOLE.type:
            break;


        case global.HMI_Element_Type.CONTAINER_TAB.type:
            break;
        case global.HMI_Element_Type.CONTAINER_PANEL.type:
            break;
        case global.HMI_Element_Type.CONTAINER_CAROUSEL.type:
            break;*/


        case global.HMI_Element_Type.ACCESSORY_TEXT.type:
            $('#'+current_element.id)
            .text(current_element._element_properties_obj.text);
            break;

        case global.HMI_Element_Type.ACCESSORY_LABEL.type:
            $('#'+current_element.id)
            .text(current_element._element_properties_obj.text);
            break;

        case global.HMI_Element_Type.ACCESSORY_IMAGE.type:
            document.getElementById(current_element.id).src = current_element._element_properties_obj.image;
            break;
    }
}

function AppendNewElementToContainer(event_type, element_type, event_DOM, enable_resizable){
    jQuery('#hmi_div div .ui-selected').each(function() {
        var new_element_id = null;
        do {
            new_element_id = event_type + '-' + element_type + '-' + _random_generator.randomString(element_id_length);
            var id_exist = false;
            for (obj in hmi_element_list[event_type][element_type]) {
                if (new_element_id === hmi_element_list[event_type][element_type][obj].id) {
                    id_exist = true;
                }
            }
        }while (id_exist === true);

        $(this).append('<div id="'+new_element_id+'_div'+'" class="hmi_element_containment">'+event_DOM+'</div>');

        $('#'+new_element_id+'_div .hmi_element').attr('id', new_element_id);

        var dimensions = {
            height: $('#'+new_element_id).height(),
            width: $('#'+new_element_id).width()
        };

        var offset = $('#'+new_element_id).position();

        $('#'+new_element_id+'_div')
            .css({
                position: "absolute",
                top: offset.top,
                left: offset.left,
                height: dimensions.height,
                width: dimensions.width
            });

        var parent = {
            parent_id: $(this).index(),
            parent_type: global.StorageTypes.GRID.value
        };

        hmi_element_list[event_type][element_type][new_element_id] = new hmi_element_obj(new_element_id, element_type, offset, dimensions, parent, null);
        HmiTooltipCreate(new_element_id, enable_resizable);
    });
}

function AppendExistingElementToContainer(parent_id, current_event, enable_resizable){
    var event_DOM = null;
    for(var element in global.HMI_Element_Type){
        if(global.HMI_Element_Type[element].type === current_event.element_type){
            event_DOM = global.HMI_Element_Type[element].DOM;
        }
    }
    $('<div id="'+current_event.id+'_div'+'" class="hmi_element_containment"></div>')
        .css(
        {
            position: "absolute",
            top: current_event.offset.top,
            left: current_event.offset.left,
            height: current_event.dimension.height,
            width: current_event.dimension.width
        })
        .appendTo(parent_id);

    $(event_DOM).appendTo('#'+current_event.id+'_div');

    $('#'+current_event.id+'_div .hmi_element')
        .attr('id', current_event.id)
        .css({
            marginLeft: 0, marginTop: 0,
            top: current_event.offset.top,
            left: current_event.offset.left,
            height: current_event.dimension.height,
            width: current_event.dimension.width
        });

    HmiTooltipCreate(current_event.id, enable_resizable);
}

function AddElement(this_element) {
    var element_type = $(this_element).attr('element');

    switch (element_type){
        case global.HMI_Element_Type.IO_BUTTON.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.IO_EVENTS, element_type, global.HMI_Element_Type.IO_BUTTON.DOM, true);
            break;

        case global.HMI_Element_Type.IO_BUTTON_SCENARIO.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.IO_EVENTS, element_type, global.HMI_Element_Type.IO_BUTTON_SCENARIO.DOM, true);
            break;

        case global.HMI_Element_Type.IO_BUTTON_SCRIPT.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.IO_EVENTS, element_type, global.HMI_Element_Type.IO_BUTTON_SCRIPT.DOM, true);
            break;

     /*   case global.HMI_Element_Type.IO_BUTTON_INPUT.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.IO_EVENTS, element_type, global.HMI_Element_Type.IO_BUTTON_INPUT.DOM, true);
            break;
        case global.HMI_Element_Type.IO_BUTTON_DROPDOWN.type:
            //AppendNewElementToContainer();
            break;
        case global.HMI_Element_Type.IO_BUTTON_INPUT_DROPDOWN.type:
            //AppendNewElementToContainer();
            break;
        case global.HMI_Element_Type.VIEWER_GRAPH.type:
            //AppendNewElementToContainer();
            break;*/

        case global.HMI_Element_Type.VIEWER_TABLE.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.VIEWER, element_type, global.HMI_Element_Type.VIEWER_TABLE.DOM, false);
            break;

        case global.HMI_Element_Type.VIEWER_GAUGE.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.VIEWER, element_type, global.HMI_Element_Type.VIEWER_GAUGE.DOM, false);
            break;

        case global.HMI_Element_Type.VIEWER_LED.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.VIEWER, element_type, global.HMI_Element_Type.VIEWER_LED.DOM, false);
            break;

       /* case global.HMI_Element_Type.VIEWER_CONSOLE.type:
            //AppendNewElementToContainer();
            break;
        case global.HMI_Element_Type.CONTAINER_TAB.type:
            //AppendNewElementToContainer();
            break;
        case global.HMI_Element_Type.CONTAINER_PANEL.type:
            //AppendNewElementToContainer();
            break;
        case global.HMI_Element_Type.CONTAINER_CAROUSEL.type:
            //AppendNewElementToContainer();
            break;*/

        case global.HMI_Element_Type.ACCESSORY_TEXT.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.ACCESSORY, element_type, global.HMI_Element_Type.ACCESSORY_TEXT.DOM, true);
            break;

        case global.HMI_Element_Type.ACCESSORY_LABEL.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.ACCESSORY, element_type, global.HMI_Element_Type.ACCESSORY_LABEL.DOM, true);
            break;

        case global.HMI_Element_Type.ACCESSORY_IMAGE.type:
            AppendNewElementToContainer(global.HMI_Event_Type_List.ACCESSORY, element_type, global.HMI_Element_Type.ACCESSORY_IMAGE.DOM, true);
            break;
    }
}

function IoButtonExecute(configuration){
    $('#'+configuration.id).on('click', function(){
        if(_comms_socket_obj[configuration._element_properties_obj._message_attribute.interface_name] !== undefined) {
            /*todo internal data manipulation*/
            for(manipulation in global.DataManipulationTypes) {
                console.log('DEBUG','Manipulation type', global.DataManipulationTypes[manipulation], manipulation);
                if(global.DataManipulationTypes[manipulation].name !== global.DataManipulationTypes.CONVERSION.name) {
                        InternalFieldValueManipulation(configuration.id,
                            configuration._element_properties_obj._message_attribute.interface_name,
                            configuration.id,
                            configuration._element_properties_obj._messageArr,
                            global.DataManipulationTypes[manipulation].name);
                }
            }
            InternalFieldValueManipulation(configuration.id,
                configuration._element_properties_obj._message_attribute.interface_name,
                configuration.id,
                configuration._element_properties_obj._messageArr,
                global.DataManipulationTypes.CONVERSION.name);

            switch (configuration._element_properties_obj._transmit_options.transmit_option) {
                case global.TransmitMessageTypes.SINGLE.value:
                    try {
                        global.socket_master[urlId][configuration._element_properties_obj._message_attribute.interface_name].
                            primus.write(
                            new transmit_packet(
                                global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX,
                                configuration.id,
                                configuration._element_properties_obj._message_attribute.interface_name,
                                configuration._element_properties_obj._dataByteLength,
                                configuration._element_properties_obj._messageArr,
                                1,
                                configuration._element_properties_obj._transmit_options.transmit_option
                            )
                        );
                    } catch (e) {
                        errorFound = true;
                        console.log(e);
                    }
                    break;
                case global.TransmitMessageTypes.FINITE.value:
                    try {
                        if ($(this).attr('isActive') == 'false') {
                            var errorFound = false;
                            var transmit_package = new transmit_packet(
                                global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX,
                                configuration.id,
                                configuration._element_properties_obj._message_attribute.interface_name,
                                configuration._element_properties_obj._dataByteLength,
                                configuration._element_properties_obj._messageArr,
                                configuration._element_properties_obj._transmit_options.transmit_option_attributes.counter,
                                configuration._element_properties_obj._transmit_options.transmit_option
                            );
                            global.socket_master[urlId][configuration._element_properties_obj._message_attribute.interface_name]
                                .primus.write(transmit_package);

                            console.log(global.socket_master[urlId]);
                        }
                        else {
                            global.socket_master[urlId][configuration._element_properties_obj._message_attribute.interface_name]
                                .primus
                                .write({
                                    protocol: global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_REMOVE,
                                    id: configuration.id
                                });
                            $(this).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
                        }
                    } catch (e) {
                        errorFound = true;
                        console.log(e);
                    }
                    if (errorFound === false) {
                        messages_in_transmission[configuration.id] = transmit_package;
                        $(this).removeClass('btn-success').addClass('btn-danger').attr('isActive', true);
                    }
                    break;
                case global.TransmitMessageTypes.INFINITE.value:
                    try {
                        if ($(this).attr('isActive') == 'false') {
                            var errorFound = false;
                            var transmit_package = new transmit_packet(
                                global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX,
                                configuration.id,
                                configuration._element_properties_obj._message_attribute.interface_name,
                                configuration._element_properties_obj._dataByteLength,
                                configuration._element_properties_obj._messageArr,
                                1,
                                configuration._element_properties_obj._transmit_options.transmit_option
                            );
                            global.socket_master[urlId][configuration._element_properties_obj._message_attribute.interface_name]
                                .primus.write(transmit_package);
                        }
                        else {
                            global.socket_master[urlId][configuration._element_properties_obj._message_attribute.interface_name]
                                .primus.write({
                                    protocol: global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_REMOVE,
                                    id: configuration.id
                                });
                            $(this).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
                        }
                    } catch (e) {
                        errorFound = true;
                        console.log(e);
                    }
                    if (errorFound === false) {
                        messages_in_transmission[configuration.id] = transmit_package;
                        $(this).removeClass('btn-success').addClass('btn-danger').attr('isActive', true);
                    }
                    break;
                case global.TransmitMessageTypes.RESPOND_REPLY.value:
                    try {
                        if ($(this).attr('isActive') == 'false') {
                            var transmit_package = new transmit_packet(
                                global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX,
                                configuration.id,
                                configuration._element_properties_obj._message_attribute.interface_name,
                                configuration._element_properties_obj._dataByteLength,
                                configuration._element_properties_obj._messageArr,
                                1,
                                configuration._element_properties_obj._transmit_options.transmit_option
                            );

                            if (respond_reply_arr[configuration._element_properties_obj.interface] === undefined) {
                                respond_reply_arr[configuration._element_properties_obj.interface] = {};
                            }
                            if (respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message] === undefined) {
                                respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message] = [];
                            }

                            messages_in_transmission[configuration.id] = transmit_package;
                            respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message]
                                .push(configuration.id);
                            $(this).removeClass('btn-success').addClass('btn-danger').attr('isActive', true);
                        }
                        else {
                            respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message]
                                .splice(configuration.id, 1);
                            delete messages_in_transmission[configuration.id];
                            $(this).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
                        }
                    } catch (e) {
                        errorFound = true;
                        console.log(e);
                    }
                    if (errorFound === false) {
                        messages_in_transmission[configuration.id] = transmit_package;
                        respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message].push(configuration.id);
                        $(this).removeClass('btn-success').addClass('btn-danger').attr('isActive', true);
                    }
                    break;
                case global.TransmitMessageTypes.RESPOND_UNTIL.value:
                    try {
                        if ($(this).attr('isActive') == 'false') {
                            var errorFound = false;
                            var transmit_package = new transmit_packet(
                                global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX,
                                configuration.id,
                                configuration._element_properties_obj._message_attribute.interface_name,
                                configuration._element_properties_obj._dataByteLength,
                                configuration._element_properties_obj._messageArr,
                                1,
                                configuration._element_properties_obj._transmit_options.transmit_option
                            );

                            if (respond_reply_arr[configuration._element_properties_obj.interface] === undefined) {
                                respond_reply_arr[configuration._element_properties_obj.interface] = {};
                            }
                            if (respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message] === undefined) {
                                respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message] = [];
                            }
                            global.socket_master[urlId][configuration._element_properties_obj._message_attribute.interface_name]
                                .primus.write(transmit_package);
                        }
                        else {
                            respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message].splice(configuration.id, 1);
                            global.socket_master[urlId][configuration._element_properties_obj._message_attribute.interface_name]
                                .primus.write({protocol: global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_REMOVE, id: configuration.id});
                            $(this).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
                        }
                    } catch (e) {
                        errorFound = true;
                        console.log(e);
                    }
                    if (errorFound === false) {
                        messages_in_transmission[configuration.id] = transmit_package;
                        respond_reply_arr[configuration._element_properties_obj.interface][configuration._element_properties_obj.message].push(configuration.id);
                        $(this).removeClass('btn-success').addClass('btn-danger').attr('isActive', true);
                    }
                    break;
            }
        }
        else{
            var error = error_list.INTERFACE_PROCESS_CLOSED;
            _hmi.ErrorAlertCreator(
                error_list.properties[error].type,
                error_list.properties[error].name,
                error_list.properties[error].message,
                error_list.properties[error].hint,
                configuration._element_properties_obj._message_attribute.interface_name,
                document);
        }
    });
}

function IoScriptExecute(configuration) {
    $('#' + configuration.id).on('click', function () {
        try {
            var current_script = configuration._element_properties_obj._script_options.script;
            if ($(this).attr('isActive') == 'false') {
                _script_process_obj[configuration.id] = childProcess
                    .spawn(
                    'node',
                    ['./node_modules/script-manager/script-manager.js'],
                    {
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                    });

                _script_process_obj[configuration.id].stdout.on('data', function (data) {
                    try {
                        //console.log(data.toString());
                        _hmi.console(data.toString(), document);
                    } catch (e) {
                        console.log(e);
                    }
                });

                _script_process_obj[configuration.id].stderr.on('data', function (data) {
                    try {
                        var error = JSON.parse(data);
                        if (error.id === error_list.SCRIPT_FILE_NOT_FOUND) {
                            // _error_manager.ErrorAlert(error.error, error.file, document);
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error.error].type,
                                error_list.properties[error.error].name,
                                error_list.properties[error.error].message,
                                error_list.properties[error.error].hint,
                                error.file,
                                document);
                            ScriptProcessClose(configuration.id);
                            $(this).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
                        }
                        else if (error.id === error_list.SCRIPT_TRANSMIT_OBJECT_INVALID) {
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error.error].type,
                                error_list.properties[error.error].name,
                                error_list.properties[error.error].message,
                                error_list.properties[error.error].hint,
                                '',
                                document
                            );
                        }
                    } catch (e) {

                    }
                });

                _script_process_obj[configuration.id]
                    .on('message', function (data) {
                        var dataObj = JSON.parse(data);
                        if (dataObj.id === global.ScriptTypeList.TRANSMIT_OBJECT.name) {
                            console.log('sending data from script', dataObj);
                            global.socket_master[urlId][dataObj.tx_interface_name].
                                primus.write(
                                new transmit_packet(
                                    global.Communication_Linker_Emitter_Obj.LINKER_MESSAGE_TX,
                                    _random_generator.randomString(script_id_length),
                                    dataObj.tx_interface_name,
                                    dataObj.tx_byte_length,
                                    dataObj.tx_message_arr,
                                    1,
                                    1
                                )
                            );
                        }
                    });
console.log('script debug',current_script,_script_list.script[current_script]);
                _script_process_obj[configuration.id]
                    .send(JSON.stringify(
                        {
                            id: global.ScriptTypeList.SCRIPT_OBJECT.name,
                            object: _script_list.script[current_script],
                            comms_arr: _comms_arr,
                            comms_status: _comms_status_obj
                        }));

                $(this).removeClass('btn-success').addClass('btn-danger').attr('isActive', true);
            }

            else {
                ScriptProcessClose(configuration.id);
                $(this).removeClass('btn-danger').addClass('btn-success').attr('isActive', false);
            }
        }
        catch(e) {
            console.log(e);
        }
    });
}

function Load_HMI(){
    /*priority 1: load the grid*/
    if(_hmi_serialize_collection !== null){
        $.each(_hmi_serialize_collection, InitialiseGridContainers);
    }

    /*priority 2: load the storage types e.g tabs, panels, carousels*/

    /*priority 3: load the io events e.g buttons, scenarios*/
    for(io_types in hmi_element_list.io_events){
        for(event in hmi_element_list.io_events[io_types]){
            var current_event = hmi_element_list.io_events[io_types][event];
            switch(current_event.parent.parent_type){
                case global.StorageTypes.GRID.value:
                    AppendExistingElementToContainer('#hmi_div div .child_container:eq('+current_event.parent.parent_id+')',current_event, true);
                    break;
                case global.StorageTypes.PANELS.value:
                    break;
                case global.StorageTypes.TABS.value:
                    break;
                case global.StorageTypes.CAROUSEL.value:
                    break;
            }
            ElementAttributeConfiguration('io_events', io_types, event);
            console.log('DEBUG', 'internal field manip after buttons', internal_field_manipulators_list);

            for(var data_manip_type in hmi_element_list.user_data_manipulators) {
                for (var parent_id in hmi_element_list.user_data_manipulators[data_manip_type]) {
                    if(parent_id === event) {
                        for (var data_manip in hmi_element_list.user_data_manipulators[data_manip_type][parent_id]) {
                            AppendExistingChildElement(hmi_element_list.user_data_manipulators[data_manip_type][parent_id][data_manip], hmi_element_list.io_events[io_types][event], hmi_element_list.user_data_manipulators[data_manip_type][parent_id][data_manip].id);
                        }
                    }
                }
            }
        }
    }

    /*priority 5: load the data viewers*/
    for(view_types in hmi_element_list.viewer){
        for(event in hmi_element_list.viewer[view_types]){
            var current_event = hmi_element_list.viewer[view_types][event];
            switch(current_event.parent.parent_type){
                case global.StorageTypes.GRID.value:
                    AppendExistingElementToContainer('#hmi_div div .child_container:eq('+current_event.parent.parent_id+')',current_event, false);
                    break;
                case global.StorageTypes.PANELS.value:
                    break;
                case global.StorageTypes.TABS.value:
                    break;
                case global.StorageTypes.CAROUSEL.value:
                    break;
            }
            ElementAttributeConfiguration('viewer', view_types, event);
        }
    }

    /*priority 6: load the accessories*/
    for(acc_types in hmi_element_list.accessories){
        for(event in hmi_element_list.accessories[acc_types]){
            var current_event = hmi_element_list.accessories[acc_types][event];
            switch(current_event.parent.parent_type){
                case global.StorageTypes.GRID.value:
                    AppendExistingElementToContainer('#hmi_div div .child_container:eq('+current_event.parent.parent_id+')',current_event, true);
                    break;
                case global.StorageTypes.PANELS.value:
                    break;
                case global.StorageTypes.TABS.value:
                    break;
                case global.StorageTypes.CAROUSEL.value:
                    break;
            }
            ElementAttributeConfiguration('accessories', acc_types, event);
        }
    }

    HmiTooltipDisable();
}

function Initialise_HMI() {
    var add_col_event_id = '#gc_add_column',
        delete_event_id = '#gc_delete_selected',
        remove_all_event_id = '#gc_remove_all',
        SaveAsHmi_save_id = '#SaveAsHmi_save',
        SaveAsDefaultHmi_save_id = '#SaveAsDefaultHmi_save',
        SaveAsWarningAlertHmi_id = '#SaveAsWarningAlertHmi';

    InitialiseGridster();
    $('#'+hmi_toolbox_div).hide();

    /*navbar setup*/
    _hmi.InitialiseNavBar(headerData, document, window);


    hmi_file_path = null;
    hmi_configuration = null;
    _hmi_serialize_collection = [];
    hmi_element_list = {};
    $('.hmi_element_containment').each(function() {
        $(this).remove();
    });

    /*Initialise the main hmi div*/
    for (var j = 0; j < global.main_configuration.simulators.length; j++) {
        if (urlId === global.main_configuration.simulators[j].id) {
            hmi_file_path = global.main_configuration.simulators[j].HMI_file_path;
            hmi_configuration = jf.readFileSync(hmi_file_path);
            _hmi_serialize_collection = hmi_configuration.grid;
            hmi_element_list = hmi_configuration.elements;
            Load_HMI();
            DisableGridster();
        }
    }

    /*grid creator and grid creator navbar setup*/
    _hmi.GridCreatorNavBar(document);
    jQuery("#gc_close").click(function () {
        jQuery("#grid_creator_div").hide();
        DisableGridster();
    });

    /*Grid Creator*/
    jQuery(add_col_event_id).click(function(e){AddGridContainer(e)});
    jQuery(delete_event_id).click(function(e){RemoveGridContainer(e, delete_event_id)});
    jQuery(remove_all_event_id).click(function(){TheFinalSolutionToTheGridProblem()});

    /*hmi element creator*/
    $('#hmi_toolbox_div .tab-content #io_events   .hmi_toolbox_element').click(function(){AddElement(this)});
    $('#hmi_toolbox_div .tab-content #viewers     .hmi_toolbox_element').click(function(){AddElement(this)});
    $('#hmi_toolbox_div .tab-content #accessories .hmi_toolbox_element').click(function(){AddElement(this)});
    $('#hmi_toolbox_div .tab-content #containers  .hmi_toolbox_element').click(function(){AddElement(this)});
    /*NOTE:
    When you set click handler for .hmi_configuration_toolbar element,
    jquery has not known about elements with this class yet.
    This is why handler does not set. The approach below,
    handles all clicks for the document and selects only addressed for .hmi_configuration_toolbar elements.*/
    $(document).on('click', '.hmi_configuration_toolbar',function(e){HmiTooltipExecute(e, this);});
    $(document).on('click', '.hmi_child_configuration_toolbar',function(e){HmiChildTooltipExecute(e, this);});
    /*hmi save as features*/
    $('#'+SaveAsHmi_modal +' '+SaveAsHmi_save_id).click(function(e){SaveAsHmi(e)});
    $('#'+SaveAsHmi_modal +' '+SaveAsDefaultHmi_save_id).click(function(e){SaveAsDefaultHmi(e)});
    $(SaveAsWarningAlertHmi_id).find(".close").click(function(e){SaveAsWarningAlertHmi(e)});
}

function Initialise_Communication_Interface(){
    if (_comms_arr != null) {
        rx_message_obj = {};
        var comms_length = _comms_arr.length;
        _comms_obj.length = comms_length;
        _comms_status_obj = {};
        /*create socket object and supply port numbers to communication interfaces*/
        for (var i = 0; i < comms_length; i++) {
            var current_interface_name = _comms_arr[i].name;

            if(_comms_status_obj[current_interface_name] === undefined) {
                _comms_status_obj[current_interface_name] = {};
            }
            _comms_status_obj[current_interface_name] = {status: global.CommsStatusEnum.CLOSED};

            _comms_obj[current_interface_name] = _comms_arr[i];

            if(_.isEmpty(internal_field_manipulators_list[global.communicationDirectionType.RECEIVE.value]) === true) {
                internal_field_manipulators_list[global.communicationDirectionType.RECEIVE.value] = {};
            }

            if(_.isEmpty(internal_field_manipulators_list[global.communicationDirectionType.RECEIVE.value][current_interface_name]) == true){
                internal_field_manipulators_list[global.communicationDirectionType.RECEIVE.value][current_interface_name] = {}
            }

            internal_field_manipulators_list[global.communicationDirectionType.RECEIVE.value][current_interface_name] = _comms_arr[i]
                .msgset
                .field_manipulation_lst;

            if(_.isEmpty(rx_message_obj[current_interface_name]) == true){
                rx_message_obj[current_interface_name] = {};
            }
            var message_size = _comms_arr[i].msgset.msg_identikit_arr.length;
            for(var j = 0 ; j<message_size; j++){
                if(_comms_arr[i].msgset.msg_identikit_arr[j].direction.toUpperCase() === 'RX'){
                    if(_.isEmpty(rx_message_obj[current_interface_name][_comms_arr[i].msgset.msg_identikit_arr[j].name]) == true){
                        rx_message_obj[current_interface_name][_comms_arr[i].msgset.msg_identikit_arr[j].name] = null;
                    }
                }
            }
            Socket_Factory(current_interface_name,
                global.Layer_Type_Enum.BACK_END,
                global.Interface_Type_Enum.LINKER_COMMUNICATION_INTERFACE,
                global.Network_Type_Enum.CLIENT);
        }


        console.log("DEBUG", "Initialise: communication div setup", rx_message_obj);
        console.log('DEBUG', 'comms obj', _comms_obj);
        console.log('DEBUG', 'internal field manip list', internal_field_manipulators_list);
        _hmi.InitialiseComms(_comms_arr, document);
        InitialiseSingleCommunicationProcess();
        InitialiseAllLinkerProcesses();

        return global.ConfigFileLoadedEnum.LOADED;
    }
}

function Initialise_Interfaces(configData, clbk) {
    try {
        if(configData !== null) {
            if (configData.interface_file_path !== undefined) {
                if (fs.existsSync(configData.interface_file_path)) {
                    try {
                        var filePath = configData.interface_file_path;
                        console.log(filePath);
                        _fileParseObj = new fileParser(filePath);
                        _fileParseObj.Setup(function (err, ifList, headerList, scriptList) {
                            console.log(err);
                            if(err !== null){
                                var error = err.error;
                                _hmi.ErrorAlertCreator(
                                    error_list.properties[error].type,
                                    error_list.properties[error].name,
                                    error_list.properties[error].message,
                                    err.message,
                                    configData.interface_file_path,
                                    document);
                                return global.ConfigFileLoadedEnum.NOTLOADED;
                            }
                            else {
                                _comms_arr = deepcopy(ifList);
                                headerData = deepcopy(headerList);
                                _script_list = deepcopy(scriptList);
                                console.log("Done Parsing Configuration File");
                                var interface_loaded = Initialise_Communication_Interface();
                                try {
                                    Initialise_HMI();
                                }catch(e){
                                    console.log('HMI ERROR',e);
                                    var error = error_list.HMI_LOAD_ERROR;
                                    _hmi.ErrorAlertCreator(
                                        error_list.properties[error].type,
                                        error_list.properties[error].name,
                                        error_list.properties[error].message,
                                        e.message,
                                        configData.HMI_file_path,
                                        document);
                                    return global.ConfigFileLoadedEnum.NOTLOADED;
                                }
                                clbk();
                            }
                        });

                    }catch(e){
                        console.log(e);
                        var error = error_list.INTERFACE_FILE_LOAD_ERROR;
                        _hmi.ErrorAlertCreator(
                            error_list.properties[error].type,
                            error_list.properties[error].name,
                            error_list.properties[error].message,
                            error_list.properties[error].hint,
                            configData.interface_file_path,
                            document);
                        return global.ConfigFileLoadedEnum.NOTLOADED;
                    }
                }
                else {
                    var error = error_list.NO_CONFIG_FILE;
                    _hmi.ErrorAlertCreator(
                        error_list.properties[error].type,
                        error_list.properties[error].name,
                        error_list.properties[error].message,
                        error_list.properties[error].hint,
                        configData.interface_file_path,
                        document);
                    return global.ConfigFileLoadedEnum.NOTLOADED;
                }
            }
        }
        else{
            var error = error_list.NEW_CONFIG_FILE;
            _hmi.ErrorAlertCreator(
                error_list.properties[error].type,
                error_list.properties[error].name,
                error_list.properties[error].message,
                error_list.properties[error].hint,
                configData.interface_file_path,
                document);

            return global.ConfigFileLoadedEnum.NOTLOADED;
        }
    }
    catch(e){
        console.log(e);
    }
    return;
}

function Initialise_Interfaces_Sync(configData) {
    try {
        if(configData !== null) {
            if (configData.interface_file_path !== undefined) {
                if (fs.existsSync(configData.interface_file_path)) {
                    try {
                        var filePath = configData.interface_file_path;
                        console.log(filePath);
                        _fileParseObj = new fileParser(filePath);
                        var fileParserObj = _fileParseObj.SetupSync();
                        console.log('sync interface',fileParserObj);
                        if(fileParserObj.error === null) {
                            _comms_arr = deepcopy(fileParserObj.interface);
                            headerData = deepcopy(fileParserObj.header);
                            _script_list = deepcopy(fileParserObj.script);
                            var interface_loaded = Initialise_Communication_Interface();
                            try {
                                Initialise_HMI();
                            }catch(e){
                                console.log('HMI ERROR',e);
                                var error = error_list.HMI_LOAD_ERROR;
                                _hmi.ErrorAlertCreator(
                                    error_list.properties[error].type,
                                    error_list.properties[error].name,
                                    error_list.properties[error].message,
                                    e.message,
                                    configData.HMI_file_path,
                                    document);
                                return global.ConfigFileLoadedEnum.NOTLOADED;
                            }
                        }
                        else{
                            var error = error_list.INTERFACE_FILE_LOAD_ERROR;
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error].type,
                                error_list.properties[error].name,
                                error_list.properties[error].message,
                                error_list.properties[error].hint,
                                configData.interface_file_path,
                                document);
                            return global.ConfigFileLoadedEnum.NOTLOADED;
                        }
                    }catch(e){
                        console.log(e);
                        var error = error_list.INTERFACE_FILE_LOAD_ERROR;
                        _hmi.ErrorAlertCreator(
                            error_list.properties[error].type,
                            error_list.properties[error].name,
                            error_list.properties[error].message,
                            e.message,
                            configData.interface_file_path,
                            document);
                        return global.ConfigFileLoadedEnum.NOTLOADED;
                    }
                }
                else {
                    var error = error_list.NO_CONFIG_FILE;
                    _hmi.ErrorAlertCreator(
                        error_list.properties[error].type,
                        error_list.properties[error].name,
                        error_list.properties[error].message,
                        error_list.properties[error].hint,
                        configData.interface_file_path,
                        document);
                    return global.ConfigFileLoadedEnum.NOTLOADED;
                }
            }
        }
        else{
            var error = error_list.NEW_CONFIG_FILE;
            _hmi.ErrorAlertCreator(
                error_list.properties[error].type,
                error_list.properties[error].name,
                error_list.properties[error].message,
                error_list.properties[error].hint,
                configData.interface_file_path,
                document);

            return global.ConfigFileLoadedEnum.NOTLOADED;
        }
    }
    catch(e){
        console.log(e);
    }
    return;
}

function CreateWindow(){
    if(global.main_configuration !== undefined){
        for(var i=0; i<global.main_configuration.simulators.length; i++) {
            if(i === 0){
                interface_file_name = global.main_configuration.simulators[i].interface_file_name;
                console.log(interface_file_name);
                urlId = global.main_configuration.simulators[i].id;
                Initialise_Interfaces_Sync(global.main_configuration.simulators[i]);
                Socket_Factory(urlId, global.Layer_Type_Enum.FRONT_END, global.Interface_Type_Enum.MAIN_SIMULATOR, global.Network_Type_Enum.SERVER);
                if(_script_list !== null){
                if(_script_list.script !== null){
                    AutomaticScriptsLauncher();
                }
            }
            }
            else if (i > 0){
                gui.Window.open('index.html?' + global.main_configuration.simulators[i].id, {
                    position: 'center'
                });
            }
        }
    }
}

function FrontEnd_Socket_Server_Emit(interface_type, spark){
    switch(interface_type){
        case global.Interface_Type_Enum.MAIN_SIMULATOR:
            break;

        case global.Interface_Type_Enum.INSTANCE_SIMULATOR:
            break;

        case global.Interface_Type_Enum.WINDOW_LOADER:
            break;

        case global.Interface_Type_Enum.WINDOW_RECORDER:
            break;
    }
}

function Socket_Server_Emitter (primus_instance_name) {
    global.socket_master[urlId][primus_instance_name].primus.on('connection', function(spark){
        var interface_type = global.socket_master[urlId][primus_instance_name].interface_type;

        if(global.socket_master[urlId][primus_instance_name].layer_type === global.Layer_Type_Enum.FRONT_END){
            FrontEnd_Socket_Server_Emit(interface_type, spark);
        }
    });
}

function Socket_Server_Connection(primus_instance_name, port_number){
    try {
        console.log(global.socket_master);
        console.log(global.socket_list);
        global.socket_master[urlId][primus_instance_name].primus = new Primus.createServer({
             iknowhttpsisbetter: true,
            port: port_number,
            transformer: 'websockets',
            timeout: false
        });
    }catch(e){
        console.log(e);
    }

    Socket_Server_Emitter(primus_instance_name);
}

function Destroy_All_Server_Connections(){
    try {
        for (primus_instance_name in global.socket_master[urlId]) {
            if (global.socket_master[urlId][primus_instance_name].primus !== null) {
                global.socket_master[urlId][primus_instance_name].primus.destroy();
            }
        }
    }catch(e){
        console.log(e);
    }
}

function Destroy_Server_Connection(primus_instance_name){
    try {
        global.socket_master[urlId][primus_instance_name].primus.destroy();
    }catch(e){
        console.log(primus_instance_name, e);
    }
}

function Socket_Dictionary(socket_arr){
    var socket_arr_length = socket_arr.length;
    for(var i=0; i<socket_arr_length; i++){
        if (typeof socket_arr[i] === 'string'){
            var lowEnd = Number(socket_arr[i].split(':')[0]);
            var highEnd = Number(socket_arr[i].split(':')[1]);
            for(var j=lowEnd; j<highEnd; j++){
                global.socket_list.push(new socket_obj(j, global.SocketInUseEnum.AVAILABLE));
            }
        }
        if (typeof socket_arr[i] === 'number'){
            global.socket_list.push(new socket_obj(i, global.SocketInUseEnum.AVAILABLE));
        }
    }
}

function Socket_Factory(primus_instance_name, layer_type, interface_type, network_type){
    var port_number = Get_Socket_Port();

    if(port_number !== null) {
        if (global.socket_master[urlId] === undefined) {
            global.socket_master[urlId] = [];
        }
        if (global.socket_master[urlId][primus_instance_name] === undefined) {
            global.socket_master[urlId][primus_instance_name] = {};
        }
        global.socket_master[urlId][primus_instance_name].port_number = port_number;
        global.socket_master[urlId][primus_instance_name].layer_type = layer_type;
        global.socket_master[urlId][primus_instance_name].interface_type = interface_type;
        global.socket_master[urlId][primus_instance_name].primus = null;

        if (network_type === global.Network_Type_Enum.SERVER) {
              Socket_Server_Connection(primus_instance_name, port_number);
        }
    }
}

function Get_Socket_Port(){
    var socket_arr_length = global.socket_list.length;
    var counter = 0;
    var available_socket_port;
    var socket_retrieved = false;
    while(socket_retrieved === false && counter !== socket_arr_length){
        if(global.socket_list[counter].in_use === global.SocketInUseEnum.AVAILABLE){
            available_socket_port = global.socket_list[counter].port;
            global.socket_list[counter].in_use = global.SocketInUseEnum.IN_USE;
            socket_retrieved = true;
        }
        counter++;
    }

    if(socket_retrieved === false){
        available_socket_port = null;
        var error = error_list.INSUFFICIENT_INTERNAL_SOCKETS_ERROR;
        _hmi.ErrorAlertCreator(
            error_list.properties[error].type,
            error_list.properties[error].name,
            error_list.properties[error].message,
            error_list.properties[error].hint,
            '',
            document);
    }
    return available_socket_port;
}

function Return_Socket_Port(port_inUse){
    var socket_arr_length = global.socket_list.length;
    var counter = 0;
    var socket_returned = false;
    console.log('global socket list',port_inUse, global.socket_list);
    while(socket_returned === false && counter !== socket_arr_length){
        if(global.socket_list[counter].port === port_inUse){
            global.socket_list[counter].in_use = global.SocketInUseEnum.AVAILABLE;
            socket_returned = true;
        }
        counter++;
    }
    console.log('global socket list', global.socket_list);
}

function Close_application(){
    Destroy_All_Server_Connections();
    if(_comms_arr != null) {
        var comms_arr_length = _comms_arr.length;
        for (var i = 0; i < comms_arr_length; i++) {
            if (_comms_socket_obj[_comms_arr[i].name] != undefined) {
                UdpSocketErrorClose(_comms_arr[i].name);
            }
        }
        Destroy_Server_Connection(urlId);
        for(var obj in global.socket_master[urlId]) {
            Return_Socket_Port(global.socket_master[urlId][obj].port_number);
        }
    }
    if(_script_process_obj !== undefined){
        for(script in _script_process_obj){
            if(_script_process_obj[script] !== undefined) {
                ScriptProcessClose(script);
            }
        }
    }
    if (win != null) {
        win.close(true);
        console.log("Closing Simulator");
        this.close(true);
    }
}

function Close_all_application(){
    gui.App.closeAllWindows();
}

function GridCreatorToggle(isVisible){
    if(isOn_ToolBox === true){
        $('#'+hmi_toolbox_div).toggle();
        HmiToolBoxToggle(false);
    }
    if(isVisible === true){
        isOn_GridCreator = true;
        EnableGridster();
    }
    else if(isVisible === false){
        isOn_GridCreator = false;
        DisableGridster();
    }
}

function HmiToolBoxToggle(isVisible){
    if(isOn_GridCreator === true){
        jQuery("#grid_creator_div").toggle();
        GridCreatorToggle(false);
    }
    if(isVisible === true){
        isOn_ToolBox = true;
        $('#hmi_div > div').selectable({
            filter: '> div',
            cancel: '.hmi_element',
            disabled: false
        });
        HmiTooltipEnable();
    }
    else if(isVisible === false){
        isOn_ToolBox = false;
        hmi_selected_containers_arr = [];
        $('#hmi_div > div .ui-selected').each(function(){
            $(this).removeClass('ui-selected');
        });
        $('#hmi_div > div').selectable("destroy");
        HmiTooltipDisable();
        $(".hmi_element_containment").each(function(){

            if($(this).hasClass('ui-draggable')){
                $(this).draggable("destroy");
            }
            if($(this).hasClass('ui-resizable')){
                $(this).resizable("destroy");
            }

        });
        console.log('hmi element list', hmi_element_list);
        hmi_configuration.elements = {};
        hmi_configuration.elements = hmi_element_list;
        jf.writeFileSync(hmi_file_path, hmi_configuration);
    }
}

/// <summary>
/// create the menu bar
/// </summary>
function Initialise_GenSim_Menu() {
    var menubar = new gui.Menu({
        type : 'menubar'
    });

    var simulator_menu = new gui.Menu(),
        file_menu = new gui.Menu(),
        edit_menu = new gui.Menu(),
        record_menu = new gui.Menu(),
        hmi_menu = new gui.Menu(),
        help_menu = new gui.Menu(),
        simulator_submenu_current = new gui.Menu(),
        simulator_submenu_all = new gui.Menu(),
        hmi_submenu_file_save = new gui.Menu();

    /*main menu items in toolbar*/
    menubar.append(new gui.MenuItem({
        type: 'normal',
        label : 'Simulator',
        submenu : simulator_menu
    }));

    menubar.append(new gui.MenuItem({
        type: 'normal',
        label : 'File',
        submenu : file_menu
    }));

    menubar.append(new gui.MenuItem({
        type: 'normal',
        label : 'Edit',
        submenu : edit_menu
    }));

    menubar.append(new gui.MenuItem({
        type: 'normal',
        label : 'Recorder',
        submenu : record_menu
    }));

    menubar.append(new gui.MenuItem({
        type: 'normal',
        label: 'HMI Workshop',
        submenu: hmi_menu
    }));

    menubar.append(new gui.MenuItem({
        type: 'normal',
        label: 'Help',
        submenu: help_menu
    }));

    /*sub menu items of each main menu item*/
    /*simulator menu*/
    simulator_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'New Instance',
        click : function () {
            var date = new Date();
            var id = date.getTime();
            gui.Window.open('index.html?'+id, {
                position : 'center'
            });
        }
    }));

    simulator_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'Load Instance',
        enabled: false,
        click : function () {

        }
    }));

    simulator_menu.append(new gui.MenuItem({
        type: 'normal',
        label : 'Current Instance',
        submenu : simulator_submenu_current
    }));

    simulator_submenu_current.append(new gui.MenuItem({
        type : 'normal',
        label : 'Delete',
        click : function () {
            /*TODO: Delete Instance and clear all child processes and sockets*/

            /* if(_intfObj != null) {
             for(var i=0; i<_intfObj.length;i++) {
             if(_comms_socket_obj[_intfObj[i].name] != undefined) {
             _comms_socket_obj[_intfObj[i].name].kill('SIGKILL');
             }
             }
             }*/

            config = jf.readFileSync(global.configFile);
            var index = undefined;
            for (var i = 0; i < config.simulators.length; i++) {
                if (config.simulators[i].id === urlId) {
                    index = i;
                }
            }
            if (index !== undefined) {
                config.simulators.splice(index, 1);
            }
            jf.writeFileSync(global.configFile, config);

            if (win != null)
                win.close(true);
            console.log("Close Current");
        }
    }));

    simulator_submenu_current.append(new gui.MenuItem({
        label : 'Exit',
        click : function () {
            /*TODO: exit Instance and clear all child processes and sockets*/

            $(document).ready(function(){
                $("#"+close_instance_modal).modal('show');
            });
        }
    }));

    simulator_menu.append(new gui.MenuItem({
        type: 'normal',
        label : 'All Instances',
        submenu : simulator_submenu_all
    }));

    simulator_submenu_all.append(new gui.MenuItem({
        type : 'normal',
        label : 'Exit',
        click : function () {
            /*TODO: Exit all instances and child processes and clear all sockets*/
            $(document).ready(function(){
                $("#close_all_instance_modal").modal('show');

                $("#close_all_instance_modal #close_all_application_modal_button").click(function(){
                    Close_all_application();
                    $("#close_all_instance_modal").modal('hide');
                });
            });
        }
    }));


    /*file menu*/
    file_menu.append(new gui.MenuItem({
        type: 'normal',
        label: 'New',
        click: function(){
            var modal_id = _hmi.FileNew(document);

            $(modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
        }
    }));

    file_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'Load',
        click : function () {
              var modal_id = _hmi.FileLoader(global.main_configuration, urlId, document, function(config_obj) {
                  var fileName = null;
                  var simulator_length = global.main_configuration.simulators.length;
                  var config_data = null;
                  console.log(config_obj);
                  if (config_obj.interface !== null) {
                      for (var i = 0; i < simulator_length; i++) {
                          if (global.main_configuration.simulators[i].id === urlId) {
                              fileName = config_obj.interface.substring(config_obj.interface.lastIndexOf("\\") + 1, config_obj.interface.lastIndexOf("."));
                              global.main_configuration.simulators[i].interface_file_path = config_obj.interface;
                              global.main_configuration.simulators[i].name = fileName;
                          }
                      }
                      jf.writeFileSync(global.configFile, global.main_configuration);
                  }

                  if (config_obj.hmi !== null) {
                      for (var i = 0; i < simulator_length; i++) {
                          if (global.main_configuration.simulators[i].id === urlId) {
                              var hmiExists = false;
                              global.main_configuration.simulators[i].HMI_file_path = config_obj.hmi;
                              if (fileName !== null) {
                                  for (hmi in global.main_configuration.hmi_storage[fileName]) {
                                      if (hmi === config_obj.interface) {
                                          hmiExists = true;
                                      }
                                  }
                                  if (hmiExists == false) {
                                      if (global.main_configuration.hmi_storage[fileName] === undefined) {
                                          global.main_configuration.hmi_storage[fileName] = [];
                                      }
                                      global.main_configuration.hmi_storage[fileName].push(config_obj.hmi);
                                  }
                              }
                          }
                      }
                      jf.writeFileSync(global.configFile, global.main_configuration);
                  }

                  if (config_obj.interface !== null || config_obj.hmi !== null) {
                      for (var i = 0; i < simulator_length; i++) {
                          if (global.main_configuration.simulators[i].id === urlId) {
                              Destroy_All_Server_Connections();

                              for (var obj in global.socket_master[urlId]) {
                                  Return_Socket_Port(global.socket_master[urlId][obj].port_number);
                              }

                              if (_script_process_obj !== undefined) {
                                  for (script in _script_process_obj) {
                                      if (_script_process_obj[script] !== undefined) {
                                          ScriptProcessClose(script);
                                      }
                                  }
                              }

                              $('#startup_div').empty();
                              $('#nav_div').empty();
                              $('#comms_div').empty();
                              $('#hmi_jumbotron').empty();
                              $('#grid_creator_div').empty();
                              TheFinalSolutionToTheGridProblem();
                              $('#hmi_div > div').removeData().empty();
                              gridster = undefined;

                              console.log(global.main_configuration.simulators[i]);

                              Initialise_Interfaces(global.main_configuration.simulators[i], function () {
                                  Socket_Factory(urlId, global.Layer_Type_Enum.FRONT_END, global.Interface_Type_Enum.INSTANCE_SIMULATOR, global.Network_Type_Enum.SERVER);
                                  if (_script_list.script !== null) {
                                      AutomaticScriptsLauncher();
                                  }
                              });
                          }
                      }
                  }

                  if (config_obj.record !== null) {
                      for (var i = 0; i < simulator_length; i++) {
                          if (global.main_configuration.simulators[i].id === urlId) {
                              global.main_configuration.simulators[i].record_file_path = config_obj.record;
                          }
                      }
                      jf.writeFile(global.configFile, global.main_configuration);
                  }
              });

            $(modal_id).on('hidden.bs.modal', function(){
                $(this).remove();
            });
        }

    }));

    file_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'HMI',
        submenu : hmi_submenu_file_save
    }));

    hmi_submenu_file_save.append(new gui.MenuItem({
        type: 'normal',
        label: 'Save As..',
        click: function(){
            $(document).ready(function(){
                $("#"+SaveAsHmi_modal).modal('show');
            });
        }
    }));

    /*edit menu*/
    edit_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'Simulator Configuration',
        click : function () {
            /*TODO: configuration_main.json simulators and hmi editor*/
        }
    }));

    edit_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'Socket Selection',
        click : function () {
            /*TODO: configuration_main.json socket edit and selection*/
        }
    }));

    /*recorder menu*/
    record_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'Configuration',
        click : function () {
            var recording_file = null;
            for (var j = 0; j < global.main_configuration.simulators.length; j++) {
                if (urlId === global.main_configuration.simulators[j].id) {
                    if (global.main_configuration.simulators[j].record_file_path !== '' /*||
                        global.main_configuration.simulators[j].record_file_path !== undefined ||
                        global.main_configuration.simulators[j].record_file_path !== null*/) {
                        recording_file = global.main_configuration.simulators[j].record_file_path;
                        if (fs.existsSync(recording_file) === false) {
                            var error = error_list.RECORDING_FILE_LOAD_ERROR;
                            _hmi.ErrorAlertCreator(
                                error_list.properties[error].type,
                                error_list.properties[error].name,
                                error_list.properties[error].message,
                                error_list.properties[error].hint,
                                '',
                                document);

                            recording_file = null;
                        }
                    }
                    else {
                        var error = error_list.NO_RECORDING_FILE;
                        _hmi.ErrorAlertCreator(
                            error_list.properties[error].type,
                            error_list.properties[error].name,
                            error_list.properties[error].message,
                            error_list.properties[error].hint,
                            '',
                            document);
                    }
                }
            }
            if (recording_file !== null) {
                var record_modal = _record_config.RecorderEditor(urlId, recording_file, function () {

                });

                $(record_modal).on('hidden.bs.modal', function () {
                    $(this).remove();
                });
            }
        }
    }));

    record_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'Viewer',
        click : function () {
            /*TODO: is this correct*/
            var recordViewWin = gui.Window.open('recordViewWindow.html?'+urlId, {
                position: 'center',
                width: 1000,
                height: 1000
            });
            recordViewWin.on('close', function () {
                recordViewWin.close(true);
                recordViewWin = null;
            });
        }
    }));

    /*hmi menu*/
    hmi_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'Grid Creator',
        click : function(){
            jQuery(function() {
                jQuery("#grid_creator_div").toggle();
                var isVisible = jQuery( "#grid_creator_div" ).is( ":visible");
                GridCreatorToggle(isVisible);
            });
        }
    }));

    hmi_menu.append(new gui.MenuItem({
        type : 'normal',
        label : 'GUI Toolbox',
        click: function() {
            $(function(){
                $('#'+hmi_toolbox_div).toggle();
                var isVisible = jQuery( '#'+hmi_toolbox_div ).is( ":visible");
                HmiToolBoxToggle(isVisible);
            });
        }
    }));

    help_menu.append(new gui.MenuItem({
        type: 'normal',
        label: 'Documentation',
        enabled: false,
        click: function(){}
    }));

    help_menu.append(new gui.MenuItem({
        type: 'normal',
        label: 'About',
        enabled: false,
        click: function(){}
    }));

    win.menu = menubar;
}

/// <summary>
/// initialise the simulator instance
/// </summary>
function Initialise_Instance(){
    Initialise_GenSim_Menu();
    urlSearch = document.location.search;
    urlId = urlSearch.substr(urlSearch.indexOf('?') + 1, urlSearch.length);
    urlId = +urlId;
    if (urlId === 0) {
        isMain = global.MainEnum.MAIN;
    }

    if (isMain === global.MainEnum.MAIN) {
        global.socket_list = [];
        global.socket_master = [];
        /*main configuration is global to be available to all instances*/
        try {
            global.main_configuration = jf.readFileSync(global.configFile);
            if (global.main_configuration === null) {
                /*TODO: error manager alert message select 'yes' to refresh config file*/
            }
            else {
                Socket_Dictionary(global.main_configuration.socket_port);

                /*rebuild the main configuration file if something went wrong*/
                if (global.main_configuration.simulators.length === 0) {
                    global.main_configuration.simulators.push({id: urlId, name: "", enabled: true, interface_file_name: "", interface_file_path: "", record_file_path: "", HMI_file_path: ""});
                    jf.writeFile(global.configFile, global.main_configuration);
                    Initialise_Interfaces_Sync(null);
                }
                else if (global.main_configuration.simulators.length > 0) {
                    interface_file_name = global.main_configuration.simulators[0].interface_file_name;
                    console.log(interface_file_name);
                    urlId = global.main_configuration.simulators[0].id;
                    CreateWindow();
                }
            }
        }
        catch(error){
            /*TODO: error manager alert message select 'yes' to refresh config file*/
            console.log(error);
        }
    }
    else if (isMain === global.MainEnum.INSTANCE) {
        if(global.main_configuration === undefined){
            /*TODO: error manager alert message select 'yes' to refresh config file*/
        }
        else{
            console.log(global.main_configuration);
            var idInConfig = global.MainEnum.NEW_INSTANCE;
            console.log(idInConfig, urlId);
            for (var j = 0; j < global.main_configuration.simulators.length; j++) {
                if (urlId === global.main_configuration.simulators[j].id) {
                    Initialise_Interfaces_Sync(global.main_configuration.simulators[j]);
                        Socket_Factory(urlId, global.Layer_Type_Enum.FRONT_END, global.Interface_Type_Enum.INSTANCE_SIMULATOR, global.Network_Type_Enum.SERVER);
                    if(_script_list !== null) {
                        if (_script_list.script !== null) {
                            AutomaticScriptsLauncher();
                        }
                    }

                    idInConfig = global.MainEnum.INSTANCE;
                }
            }

            if (idInConfig === global.MainEnum.NEW_INSTANCE) {
                console.log(idInConfig, urlId);
                global.main_configuration.simulators.push({id: urlId, name: "", enabled: true, interface_file_name: "", interface_file_path: "", record_file_path: "", HMI_file_path: ""});
                jf.writeFile(global.configFile, global.main_configuration);
                Initialise_Interfaces_Sync(null);
            }
        }
    }
}

/// <summary>
/// executes when page loads
/// </summary>
onload = function () {
    try {
        $('#'+close_instance_modal +' '+close_application_modal_button_id).click(function(){Close_application()});

        /*initialise classes*/
        _hmi = new hmi_bootstrap(jQuery, _, Backbone, Backgrid);
        _converter_msg_field_Obj = new converter();
        _counter_msg_field_Obj = new counter();
        _random_generator = new random_generator();
        _error_manager = new error_manager();
        _type_conversion = new type_conversion();
        _record_config = new record_config(jQuery, _, Backbone, Backgrid, document);
        
        /*initialise GenSim*/
        Initialise_Instance();
        
        /*********************************/
        var emscript = childProcess.spawn(
            'node',
    ['./node_modules/addon/examples/basic/hello_world/emscripten.js'],
    {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc']
            });
        
        emscript.stdout.on('data', function (data) {
            try {
                console.log(data.toString());
                _hmi.console(data.toString(), document);
            } catch (e) {
                console.log(e);
            }
        });
        
        emscript.send({ hello : 'world' });
        
        emscript.on('message', function (data) {
            console.log("Testing emscripten");
            console.log(data.toString());
        });
        /*********************************/
        

   /*     (function(){
            console.log = function (old_function) {
                return function(text){
                    old_function(text);
                    _hmi.console(text, document);
                };
        };
        }(console.log.bind(console)));*/

        /*Prevent dragging and placing objects i.e images on window*/
        document.body.addEventListener('dragover', function(e){
            e.preventDefault();
            e.stopPropagation();
        }, false);
        document.body.addEventListener('drop', function(e){
            e.preventDefault();
            e.stopPropagation();
        }, false);

        /*closing the application*/
        win.on('close', function () {
            /*TODO: exit Instance and clear all child processes and sockets*/
            $(document).ready(function () {
                $("#" + close_instance_modal).modal('show');
            });
        });
        win.maximize();
    } catch (e) {
        console.log(e);
    }
};

/*TODO: recorder comms from linker. put this function in linker*/
/*function Recorder_Socket_Client(recordObj){
 var ls = childProcess.spawn('node', ['./node_modules/recorder/RecordingToolMongoose.js', recordObj.jsonArr, recordObj.dbCollectionFileName]);
 ls.stdout.on('data', function (data) {
 });

 ls.stderr.on('data', function (data) {
 console.log('record stderr: ' + data);
 });

 ls.on('close', function (code) {
 console.log('record child process exited with code ' + code);
 });
 // process.send({id: RecorderLinkerEnum.KILL});
 }*/