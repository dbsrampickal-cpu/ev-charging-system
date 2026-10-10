CREATE TABLE CUSTOMERS (
    Customer_ID NUMBER PRIMARY KEY,
    Name VARCHAR2(100) NOT NULL,
    Email VARCHAR2(100) UNIQUE NOT NULL,
    Password VARCHAR2(100) NOT NULL,
    EV_Model VARCHAR2(50),
    Battery_Percent NUMBER(3) DEFAULT 20,
    Balance NUMBER(10,2) DEFAULT 100.00
);

CREATE TABLE STATIONS (
    Station_ID NUMBER PRIMARY KEY,
    Name VARCHAR2(100) NOT NULL,
    Location VARCHAR2(150) NOT NULL
);

CREATE TABLE CHARGERS (
    Charger_ID NUMBER PRIMARY KEY,
    Station_ID NUMBER REFERENCES STATIONS(Station_ID) ON DELETE CASCADE,
    Type VARCHAR2(20) CHECK (Type IN ('Fast', 'Standard')),
    Rate_Per_kWh NUMBER(6,2) NOT NULL,
    Status VARCHAR2(20) CHECK (Status IN ('Available', 'Occupied'))
);

CREATE TABLE SESSIONS (
    Session_ID NUMBER PRIMARY KEY,
    Customer_ID NUMBER REFERENCES CUSTOMERS(Customer_ID),
    Charger_ID NUMBER REFERENCES CHARGERS(Charger_ID),
    Start_Time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    End_Time TIMESTAMP,
    Energy_kWh NUMBER(8,2) DEFAULT 0.00,
    Total_Amount NUMBER(10,2) DEFAULT 0.00,
    Status VARCHAR2(20) CHECK (Status IN ('Active', 'Completed'))
);

-- Create Sequences for Auto-Incrementing Primary Keys
CREATE SEQUENCE seq_customer_id START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE seq_session_id START WITH 1 INCREMENT BY 1;

-- PL/SQL Procedure for Session Billing & Balance Updates
CREATE OR REPLACE PROCEDURE Process_EV_Billing (
    p_session_id IN NUMBER,
    p_energy_kwh IN NUMBER
) AS
    v_charger_id NUMBER;
    v_customer_id NUMBER;
    v_rate NUMBER;
    v_total NUMBER;
BEGIN
    -- 1. Fetch Session Details
    SELECT Charger_ID, Customer_ID INTO v_charger_id, v_customer_id
    FROM SESSIONS WHERE Session_ID = p_session_id;

    -- 2. Fetch Charger Rate
    SELECT Rate_Per_kWh INTO v_rate
    FROM CHARGERS WHERE Charger_ID = v_charger_id;

    -- 3. Calculate Total Billed Amount
    v_total := p_energy_kwh * v_rate;

    -- 4. Update Session Record
    UPDATE SESSIONS 
    SET Energy_kWh = p_energy_kwh,
        Total_Amount = v_total,
        End_Time = CURRENT_TIMESTAMP,
        Status = 'Completed'
    WHERE Session_ID = p_session_id;

    -- 5. Mark Charger as Available
    UPDATE CHARGERS SET Status = 'Available' WHERE Charger_ID = v_charger_id;

    -- 6. Deduct Total Amount from Customer Balance
    UPDATE CUSTOMERS SET Balance = Balance - v_total WHERE Customer_ID = v_customer_id;
END;
/