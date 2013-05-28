exports.expects = function (logic, reporter, alwaysReport) {
    try {
        return logic();
    } catch (e) {
        reporter(e);
        return undefined;
    }
    if (alwaysReport) {
        reporter();
    }
    return undefined;
}