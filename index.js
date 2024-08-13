const express = require("express");
const Mongo = require("mongoose");
const crypto = require("crypto");
const bodyParser = require("body-parser");
const { check, validationResult } = require("express-validator");
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const fileUploader = require("express-fileupload");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static("public"));
app.use(fileUploader());

var result = require("dotenv").config();
if (result.error) {
    console.log("ENV Error: " + result.error);
}

const port = process.env.PORT || 3000;

app.set("views", "pages");
app.set("view engine", "ejs");

const uri = process.env.MONGODB_URI; 

Mongo.connect(uri).then(() => {
    console.log('Connected to MongoDB');
    createPrincipalAccount();
})
.catch((err) => console.error('Could not connect to MongoDB', err));

const User = Mongo.model("user", {
    email: String,
    password: String,
    salt: String,
    name: String,
    sessionid: String,
    role: { type: String, enum: ['Principal', 'Teacher', 'Student'], required: true }
});

const Student = Mongo.Schema({
    firstName: String,
    lastName: String,
    DOB: String,
    address: String,
    city: String,
    country: String,
    image: {
        data: Buffer,
        mimetype: String
    }
});

const Lesson = Mongo.Schema({
    lessonName: String,
    textarea: String,
    lessonDate: String,
    attendance: [String]
});

const Class = Mongo.model("class", {
    className: String,
    classLevel: String,
    startDate: String,
    endDate: String,
    level: String,
    userid: String,
    students: [Student],
    lessons: [Lesson]
});

const createPrincipalAccount = async () => {
    try {
        const principalExists = await User.findOne({ email: 'principal@classroom.com' });
        if (!principalExists) {
            const salt = randomSalt();
            const hashedPassword = crypto.createHmac("sha256", salt).update("Admin").digest("hex");
            const principal = new User({
                email: 'principal@classroom.com',
                password: hashedPassword,
                salt: salt,
                name: 'Principal',
                role: 'Principal',
                sessionid: randomString()
            });
            await principal.save();
            console.log('Principal account created');
        } else {
            console.log('Principal account already exists');
        }
    } catch (error) {
        console.error('Error creating Principal account:', error);
    }
};

const isPrincipal = (req, res, next) => {
    if (req.user.role !== 'Principal') {
        return res.status(403).send('Access denied. Only Principals are allowed.');
    }
    next();
};

const isTeacher = (req, res, next) => {
    if (req.user.role !== 'Teacher') {
        return res.status(403).send('Access denied. Only Teachers are allowed.');
    }
    next();
};

const isStudent = (req, res, next) => {
    if (req.user.role !== 'Student') {
        return res.status(403).send('Access denied. Only Students are allowed.');
    }
    next();
};

const authenticate = async (req, res, next) => {
    try {
        const sessionid = req.cookies.SESSION_ID;
        const user = await User.findOne({ sessionid: sessionid }).exec();

        if (!user) {
            console.log(user);
            res.status(401);
            res.redirect("/intro");
        } else {
            req.user = user;
            next();
        }
    } catch (err) {
        console.error('Error in authentication:', err);
        res.status(500).send('Internal Server Error');
    }
};

app.get("/", authenticate, async (req, res) => {
    try {
        const classes = await Class.find({ userid: req.user._id }).exec();
        console.log("docs: " + classes);
        res.render("home", { name: req.user.name, classes: classes });
    } catch (err) {
        console.error('Error fetching classes:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/livestream', (req, res) => {
    res.render('livestream');
});

app.get('/troll', (req, res) => {
    res.render('troll');
});

app.get('/signup', (req, res) => {
    res.render('signup');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/intro', (req, res) => {
    res.render('intro');
});

app.get('/class/:id/', authenticate, async (req, res) => {
    try {
        const classDoc = await Class.findOne({ _id: req.params.id, userid: req.user._id }).exec();
        if (!classDoc) {
            console.error('Class not found');
            res.status('404');
            res.render('404');
            return;
        }
        res.render('class', classDoc);
    } catch (err) {
        console.error('Error fetching class:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.get("/class/:classid/lesson/:lessonid", authenticate, async (req, res) => {
    try {
        const classDoc = await Class.findOne({ _id: req.params.classid, userid: req.user._id }).exec();

        if (classDoc) {
            const lessonDoc = classDoc.lessons.id(req.params.lessonid);
            const students = classDoc.students;

            let attendance = [];
            let absent = [];

            for (studentid of lessonDoc.attendance) {
                if (students.id(studentid))
                    attendance.push(students.id(studentid));
            }

            res.render('lesson', { result: lessonDoc, students: students, attendance: attendance, absent: absent });
        }
    } catch (err) {
        console.error('Error fetching lesson:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.get("/class/:classid/student/:studentid", authenticate, async (req, res) => {
    try {
        const classDoc = await Class.findOne({ _id: req.params.classid, userid: req.user._id }).exec();

        if (classDoc) {
            const studentDoc = classDoc.students.id(req.params.studentid);
            if (!studentDoc) {
                res.redirect(`/class/${req.params.classid}/`);
            }

            const lessons = classDoc.lessons;
            const lessonQuantity = classDoc.lessons.length;
            let counter = 0;

            const attendanceArray = lessons.map(lesson => {
                if (lesson.attendance.includes(studentDoc._id)) {
                    counter += 1;
                    return { lessonName: lesson.lessonName, lessonDate: lesson.lessonDate, present: true };
                } else {
                    return { lessonName: lesson.lessonName, lessonDate: lesson.lessonDate, present: false };
                }
            });

            const attendancePercentage = Math.round((counter / lessonQuantity) * 100);
            res.render('student', { student: studentDoc, attendance: attendancePercentage, attendanceArray: attendanceArray });
        }
    } catch (err) {
        console.error('Error fetching student:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/logout', (req, res) => {
    res.cookie('SESSION_ID', '', { maxAge: 1 });
    res.redirect('/');
});

app.post('/signup', [
    check("firstname", "must have a first name !").not().isEmpty(),
    check("lastname", "must have a last name !").not().isEmpty(),
    check("email", "must have an email !").isEmail(),
    check("password", "must have a password").not().isEmpty()
], async (req, res) => {
    try {
        const userRole = req.user ? req.user.role : 'Principal';  // Default to 'Principal' if user is not logged in
        const errors = validationResult(req);
        const password = req.body.password;
        const password2 = req.body.passwordConfirm;

        const user = await User.findOne({ email: req.body.email }).exec();
        if (user) {
            return res.render("signup", {
                message: "Email address is already taken!",
                role: userRole
            });
        }

        if (!errors.isEmpty()) {
            return res.render("signup", {
                errors: errors.array(),
                role: userRole
            });
        }

        if (password !== password2) {
            return res.render("signup", {
                message: "Passwords do not match!",
                role: userRole
            });
        }

        const name = `${req.body.firstname} ${req.body.lastname}`;
        const email = req.body.email;
        const salt = randomSalt();
        const hashedAndSaltedPassword = crypto.createHmac("sha256", salt).update(password).digest("hex");
        const sessionid = randomString();

        const newUser = new User({
            email: email,
            password: hashedAndSaltedPassword,
            salt: salt,
            name: name,
            sessionid: sessionid,
            role: userRole
        });

        await newUser.save();
        res.cookie('SESSION_ID', sessionid, { maxAge: 900000, httpOnly: true });
        res.redirect('/');
    } catch (err) {
        console.error('Error signing up:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email }).exec();
        if (!user) {
            return res.render("login", { message: "Email address not found!" });
        }

        const hashedPassword = crypto.createHmac("sha256", user.salt).update(req.body.password).digest("hex");
        if (hashedPassword === user.password) {
            const sessionid = randomString();
            user.sessionid = sessionid;
            await user.save();

            res.cookie("SESSION_ID", sessionid, { maxAge: 900000, httpOnly: true });
            res.redirect("/");
        } else {
            res.render("login", { message: "Invalid credentials!" });
        }
    } catch (err) {
        console.error('Error logging in:', err);
        res.status(500).send('Internal Server Error');
    }
});
app.post("/addclass", authenticate, async (req, res) => {
    try {
        console.log(req.body);

        const userid = req.user._id;
        console.log(userid);

        const newClass = new Class({
            className: req.body.className,
            level: req.body.level,
            startDate: req.body.startDate,
            endDate: req.body.endDate,
            userid: userid
        });

        await newClass.save();
        console.log("Class added!");
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error adding class');
    }
});

app.post('/addstudent/:id', authenticate, async (req, res) => {
    try {
        const classid = req.params.id;
        let data = req.body;
        const image = req.files.image;

        const necessaryImgData = {
            data: image.data,
            mimetype: image.mimetype
        };

        data.image = necessaryImgData;

        const classdoc = await Class.findOne({_id: classid, userid: req.user._id});

        if (!classdoc) {
            console.log("Cannot find the class ...");
            res.status(404).send('Could not find the class');
            return;
        }

        classdoc.students.push(data);
        await classdoc.save();
        console.log('Added a new student');
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error adding student');
    }
});

app.post('/addlesson/:id', authenticate, async (req, res) => {
    try {
        const classid = req.params.id;
        const data = req.body;

        console.log('classid', classid);
        console.log("Data", data);

        const classdoc = await Class.findOne({_id: classid, userid: req.user._id});

        if (!classdoc) {
            res.status(404).send('Class not found');
            return;
        }

        classdoc.lessons.push(data);
        await classdoc.save();
        console.log('Added a new lesson');
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error adding lesson');
    }
});

app.post("/class/:classid/lesson/:lessonid", authenticate, async (req, res) => {
    try {
        const classid = req.params.classid;
        const lessonid = req.params.lessonid;

        console.log(req.body);

        const classDoc = await Class.findOne({_id: classid, userid: req.user._id});
        if (!classDoc) {
            res.status(404).send('Class not found');
            return;
        }

        const lessonDoc = classDoc.lessons.id(lessonid);
        for (const studentid in req.body) {
            if (classDoc.students.id(studentid)) {
                lessonDoc.attendance.push(studentid);
            }
        }

        await classDoc.save();
        console.log('Attendance updated');
        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating attendance');
    }
});

app.delete('/class/:classid/student/:studentid', authenticate, async (req, res) => {
    try {
        const classDoc = await Class.findOne({_id: req.params.classid, userid: req.user._id});
        if (!classDoc) {
            res.status(404).send('Class not found');
            return;
        }

        const studentDoc = classDoc.students.id(req.params.studentid);
        if (!studentDoc) {
            res.status(404).send('Student not found');
            return;
        }

        studentDoc.remove();
        await classDoc.save();
        console.log('Removed student successfully');
        res.send('Removed student successfully');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error removing student');
    }
});

app.listen(port, () => {
    console.log("Listening at ", port);
});

function randomString() {
    return crypto.randomBytes(32).toString('hex');
}

function randomSalt() {
    return crypto.randomBytes(16).toString("hex");
}

