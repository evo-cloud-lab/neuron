exports.expects = function (logic, reporter, alwaysReport) {
    try {
        logic();
    } catch (e) {
        reporter(e);
        return;
    }
    if (alwaysReport) {
        reporter();
    }
}