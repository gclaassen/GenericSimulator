/**
 * Created by Gert Claassen on 7/19/2015.
 */
function test_function_06 (int32, int8) {
    var test= int32 * int8;
    console.log('in test function 06', test);
    return test;
}

function test_function_0b(return_val_06){
    console.log('in test function 0b');
    return 225 - return_val_06;
}

function test_function_0a(message_RX_A_obj){
    console.log('in test function 0a', message_RX_A_obj);
    if(message_RX_A_obj === null){
        console.log('nothing yet');
    }
    else{
        console.log('yeah got an rx message');

    }
    var test_msg_obj = {
        buffer_size: 4,
        message_array: [
            {
                "type": "INT32",
                //   "type_length": 4,
                "count": 1,
                "value": 1
                //    "field_number": 0,
                //    "name": "test_msg_1"
            }
        ]
    };
    return test_msg_obj;
}


module.exports.test_function_06 = test_function_06;
module.exports.test_function_0a = test_function_0a;
module.exports.test_function_0b = test_function_0b;