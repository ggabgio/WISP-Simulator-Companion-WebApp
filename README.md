# WISP Simulator Companion Web App

This web application serves as the companion platform for the **WISP Training Simulator**, a capstone project designed to simulate wireless internet installation training and track user performance.

The web app allows trainees and administrators to interact with the simulator data through Firebase Authentication and Firestore.

---

Regular users can log in to access their personal training results from the WISP Simulator.

Users can:

* Log in to their account
* View their **training scores / assessment results**
* Track their progress from completed simulator sessions

Users **cannot modify scores, manage users, or access administrative features**.

---

### Administrator

Administrators have access to additional management tools within the web application.

Admins can:

* View the **global leaderboard**
* Manage and update **user scores**
* Assign or modify **user roles**
* Register **new user accounts**
* Monitor training performance data

Administrative functions are restricted using **Firebase Authentication and Firestore security rules**.

---

## Technologies Used

* **HTML / CSS**
* **JavaScript**
* **Firebase Authentication**
* **Firebase Firestore**
* **Firebase Hosting**

---

## Purpose

This system complements the **WISP Training Simulator** by providing a centralized platform for storing, monitoring, and reviewing user training results.

It allows instructors or administrators to evaluate trainee/employee performance while allowing users to monitor their own progress.

---

## Related Project

This web application works alongside the **WISP Simulator**, a Unity-based training and assessment simulator used to simulate real-world wireless internet installation procedures.
