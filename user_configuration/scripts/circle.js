/**
 * Created by za120487 on 2015/04/08.
 */
function circumference (rad, pi, root) {
        var circumferenceOfCircle = null;
        circumferenceOfCircle = rad * pi * root;
        return circumferenceOfCircle;
    }
module.exports.circle = circumference;